"""Download official buy/sell CSV releases, then submit bounded city batches.

No geocoding, listings scraping, raw CSV retention or user-triggered acquisition.
History is opt-in; cron downloads only the current release. Existing snapshots
remain readable if download, validation or the atomic server import fails.
"""
import argparse
import calendar
import csv
import datetime as dt
import io
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import zipfile

BASE = "https://plvr.land.moi.gov.tw"
CITIES = {"A": "臺北市", "F": "新北市"}
FIELDS = ["鄉鎮市區", "交易標的", "土地位置建物門牌", "土地區段位置建物區段門牌", "主要用途",
          "交易年月日", "交易筆棟數", "移轉層次", "總樓層數", "建物型態", "建築完成年月",
          "建物移轉總面積平方公尺", "建物現況格局-房", "總價元", "車位類別", "車位移轉總面積平方公尺",
          "車位總價元", "備註", "編號", "電梯"]
REQUIRED_FIELDS = {"鄉鎮市區", "交易標的", "主要用途", "交易年月日", "建物型態",
                   "建物移轉總面積平方公尺", "總價元", "編號"}
ADDRESS_FIELDS = {"土地位置建物門牌", "土地區段位置建物區段門牌"}


def releases(history_years, today):
    if history_years:
        quarter_start = today.month - (today.month - 1) % 3
        for year in range(today.year - history_years, today.year + 1):
            for quarter in range(1, 5):
                month = quarter * 3
                end = dt.date(year, month, calendar.monthrange(year, month)[1])
                if end >= today or end < dt.date(today.year - history_years, quarter_start, 1):
                    continue
                yield f"{year - 1911}S{quarter}", end.isoformat()
    yield "current", today.isoformat()


def csv_rows(archive, code):
    member = next((name for name in archive.namelist() if name.lower().split('/')[-1] == f"{code.lower()}_lvr_land_a.csv"), None)
    if not member:
        raise ValueError(f"Missing official buy/sell CSV for city {code}")
    info = archive.getinfo(member)
    if info.file_size > 40_000_000:
        raise ValueError("CSV exceeds bounded download size")
    raw = archive.read(member)
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("big5")
    reader = csv.DictReader(io.StringIO(text))
    headers = set(reader.fieldnames or [])
    if not REQUIRED_FIELDS.issubset(headers) or not ADDRESS_FIELDS.intersection(headers):
        raise ValueError("Official schema changed; refusing import")
    result = []
    for row in reader:
        if not (row.get("交易年月日") or "").strip().isdigit():
            continue  # Official English header is not a transaction.
        result.append({name: row[name] or "" for name in FIELDS if name in row})
        if len(result) > 30000:
            raise ValueError("City release exceeds 30000 rows; previous data retained")
    if not result:
        raise ValueError("Empty release; previous data retained")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--history-years", type=int, choices=[0, 1, 3, 5], default=0)
    parser.add_argument("--cities", default="A,F")
    args = parser.parse_args()
    codes = args.cities.split(',')
    if not codes or any(code not in CITIES for code in codes):
        raise ValueError("Supported cities: A,F")
    endpoint = (os.environ.get("STREETLENS_REFRESH_URL") or os.environ.get("STREETLENS_BASE_URL", "")).rstrip('/')
    for suffix in ['/api/data/refresh', '/api/internal/refresh-data']:
        if endpoint.endswith(suffix):
            endpoint = endpoint[:-len(suffix)]
    parsed = urllib.parse.urlparse(endpoint)
    token = os.environ.get("STREETLENS_REFRESH_TOKEN", "")
    if parsed.scheme != 'https' or not parsed.hostname or not token:
        raise ValueError("HTTPS StreetLens URL and refresh token are required")
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date()
    failures = []
    for key, published in releases(args.history_years, today):
        params = {"type": "zip", "fileName": "lvr_landcsv.zip"}
        if key != 'current':
            params['season'] = key
        source = BASE + ('/DownloadOpenData' if key == 'current' else '/DownloadSeason') + '?' + urllib.parse.urlencode(params)
        request = urllib.request.Request(source, headers={"User-Agent": "StreetLens housing batch/1.0", "Accept": "application/zip"})
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                raw = response.read(80_000_001)
            if len(raw) > 80_000_000 or not raw.startswith(b'PK'):
                raise ValueError("Official download is not a bounded ZIP; stopping without empty import")
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                for code in codes:
                    body = json.dumps({"city": CITIES[code], "datasetKey": key, "publishedOn": published,
                                       "sourceUrl": source, "rows": csv_rows(archive, code)}, ensure_ascii=False).encode()
                    if len(body) > 12_000_000:
                        raise ValueError("Import exceeds 12 MB; previous data retained")
                    request = urllib.request.Request(endpoint + '/api/internal/import-housing', data=body,
                        headers={"Authorization": 'Bearer ' + token, "Content-Type": "application/json"})
                    try:
                        with urllib.request.urlopen(request, timeout=180) as response:
                            result = json.load(response)
                    except urllib.error.HTTPError as error:
                        raise RuntimeError(f"Housing import HTTP {error.code}; source {key}/{code}") from None
                    print(json.dumps({"release": key, "city": code, **result}, ensure_ascii=False))
        except (urllib.error.URLError, ValueError, RuntimeError, zipfile.BadZipFile) as error:
            # A not-yet-published historical quarter must not prevent the current
            # release from importing. Report incompleteness with a failed action.
            failures.append(key)
            print(json.dumps({"release": key, "status": "failed", "reason": type(error).__name__}))
    if failures:
        raise RuntimeError("Housing releases incomplete: " + ','.join(failures))



if __name__ == '__main__':
    main()
