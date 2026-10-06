"""Filter a Geofabrik PBF in a batch worker; never run this in a user request."""
import json
import sys
import osmium
from shapely import wkb

BBOX = (121.45, 24.95, 121.67, 25.22)


def classify(tags):
    amenity = tags.get('amenity', '')
    shop = tags.get('shop', '')
    if shop == 'supermarket': return 'supermarket'
    if shop == 'convenience': return 'convenience'
    if amenity in ('clinic', 'hospital', 'doctors', 'dentist'): return 'clinic'
    if amenity in ('school', 'college', 'university', 'kindergarten'): return 'school'
    if amenity in ('bank', 'post_office'): return 'bank_post'
    if amenity == 'marketplace': return 'market'
    if tags.get('leisure') == 'park': return 'park'
    if tags.get('highway') == 'bus_stop': return 'bus'
    if tags.get('railway') in ('station', 'halt'): return 'rail'
    if amenity in ('library', 'community_centre'): return 'community'
    return None


class Extract(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.points = {}
        self.factory = osmium.geom.WKBFactory()
        self.skipped_invalid_areas = 0

    def add(self, key, tags, lat, lng, method):
        kind = classify(tags)
        if not kind or not (BBOX[0] <= lng <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]): return
        if len(self.points) >= 30000: raise ValueError('Extract exceeds 30000 feature budget')
        # Names come only from mapped tags; no generated business names.
        name = tags.get('name:zh', tags.get('name', ''))[:250]
        self.points[key] = dict(id=key, name=name, lat=lat, lng=lng,
            properties=dict(amenityType=kind, coordinateMethod=method))

    def node(self, node):
        if classify(node.tags) and node.location.valid():
            self.add('n' + str(node.id), node.tags, node.location.lat, node.location.lon, 'node')

    def area(self, area):
        if not classify(area.tags): return
        try:
            geometry = wkb.loads(self.factory.create_multipolygon(area), hex=True)
            if geometry.is_empty: raise ValueError('Empty mapped area')
        except (RuntimeError, ValueError):
            # Malformed upstream areas have no usable coordinate evidence.
            self.skipped_invalid_areas += 1
            return
        # Derived point lies inside the mapped polygon. It is not an entrance.
        point = geometry.representative_point()
        key = ('w' if area.from_way() else 'r') + str(area.orig_id())
        self.add(key, area.tags, point.y, point.x, 'polygon_representative_point')


if __name__ == '__main__':
    handler = Extract()
    handler.apply_file(sys.argv[1], locations=True, idx='flex_mem')
    if len(handler.points) < 10: raise ValueError('Empty/incomplete extract; preserve existing inventory')
    # Use Geofabrik extract timestamp, not import time, as data freshness.
    header = osmium.io.Reader(sys.argv[1]).header()
    timestamp = header.get('osmosis_replication_timestamp') or sys.argv[3]
    result = dict(source='https://download.geofabrik.de/asia/taiwan.html',
        sourceUpdatedAt=timestamp, skippedInvalidAreas=handler.skipped_invalid_areas, points=sorted(handler.points.values(), key=lambda p: p['id']))
    with open(sys.argv[2], 'w', encoding='utf-8') as output:
        json.dump(result, output, ensure_ascii=False, separators=(',', ':'))
    print(json.dumps(dict(pointCount=len(handler.points), sourceUpdatedAt=timestamp, skippedInvalidAreas=handler.skipped_invalid_areas)))
