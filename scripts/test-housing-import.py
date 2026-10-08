import importlib.util
import io
import unittest
import zipfile
import datetime as dt
import csv
from pathlib import Path

spec = importlib.util.spec_from_file_location('housing_import', Path(__file__).with_name('import-housing.py'))
housing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(housing)


class OfficialHousingImport(unittest.TestCase):
    def valid_csv(self, omitted=None, address='土地位置建物門牌'):
        fields = sorted(housing.REQUIRED_FIELDS | {address, '備註'})
        if omitted:
            fields.remove(omitted)
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=fields)
        writer.writeheader()
        writer.writerow({key: 'English header' for key in fields})
        writer.writerow({key: ('1150102' if key == '交易年月日' else 'quoted, remark' if key == '備註' else 'fixture') for key in fields})
        return buffer.getvalue()
    def archive(self, text, name='a_lvr_land_a.csv'):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr(name, '\ufeff' + text)
        buffer.seek(0)
        return zipfile.ZipFile(buffer)

    def test_csv_headers_quotes_and_english_row(self):
        with self.archive(self.valid_csv()) as archive:
            rows = housing.csv_rows(archive, 'A')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['備註'], 'quoted, remark')

    def test_each_parser_required_column_is_checked(self):
        for field in housing.REQUIRED_FIELDS | {'土地位置建物門牌'}:
            with self.subTest(field=field), self.archive(self.valid_csv(omitted=field)) as archive:
                with self.assertRaisesRegex(ValueError, 'schema changed'):
                    housing.csv_rows(archive, 'A')

    def test_address_alias_is_accepted(self):
        with self.archive(self.valid_csv(address='土地區段位置建物區段門牌')) as archive:
            self.assertEqual(len(housing.csv_rows(archive, 'A')), 1)

    def test_wrong_schema_never_imported(self):
        with self.archive('unexpected,header\none,two\n') as archive:
            with self.assertRaisesRegex(ValueError, 'schema changed'):
                housing.csv_rows(archive, 'A')

    def test_rent_or_presale_is_not_buy_sell(self):
        with self.archive('主要用途,總價元,編號,交易年月日\n住家用,1,test-only,1150102\n', 'a_lvr_land_b.csv') as archive:
            with self.assertRaisesRegex(ValueError, 'Missing official'):
                housing.csv_rows(archive, 'A')

    def test_history_windows_and_current_only_schedule(self):
        today = dt.date(2026, 10, 7)
        self.assertEqual(list(housing.releases(0, today)), [('current', '2026-10-07')])
        releases = list(housing.releases(3, today))
        self.assertEqual(releases[0][0], '112S4')
        self.assertEqual(releases[-2], ('115S3', '2026-09-30'))
        self.assertNotIn('115S4', [key for key, _ in releases])

    def test_five_year_quarterly_backfill_and_schedule(self):
        releases = list(housing.releases(5, dt.date(2026, 10, 15)))
        self.assertEqual(releases[0], ('110S4', '2021-12-31'))
        self.assertEqual(releases[-1], ('current', '2026-10-15'))
        self.assertEqual(len({key for key, _ in releases}), len(releases))
        workflow = Path(__file__).parents[1].joinpath('.github/workflows/refresh-housing.yml').read_text()
        self.assertIn("cron: '30 2 1,11,21 * *'", workflow)
        self.assertIn("cron: '30 2 15 1,4,7,10 *'", workflow)
        self.assertIn("default: '5'", workflow)
        self.assertIn("github.event.schedule == '30 2 15 1,4,7,10 *' && '5' || '0'", workflow)


if __name__ == '__main__':
    unittest.main()
