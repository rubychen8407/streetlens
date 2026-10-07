"""Filter a Geofabrik PBF in a batch worker; never run this in a user request."""
import json
import sys
import osmium
from shapely import wkb
from shapely.geometry import LineString, box

BBOX = (121.45, 24.95, 121.67, 25.22)
ROAD_TYPES = {'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'living_street', 'pedestrian', 'footway', 'path'}

def encode_line(points):
    result, previous = [], [0, 0]
    for lng, lat in points:
        for index, value in enumerate((lat, lng)):
            integer = round(value * 1000000)
            delta = integer - previous[index]
            previous[index] = integer
            encoded = (delta << 1) if delta >= 0 else ~(delta << 1)
            while encoded >= 32:
                result.append(chr((encoded & 31) + 95))
                encoded >>= 5
            result.append(chr(encoded + 63))
    return ''.join(result)


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
        self.roads = {}
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

    def way(self, way):
        if way.tags.get('highway', '') not in ROAD_TYPES: return
        if way.tags.get('access', '') in ('private','no') or way.tags.get('service', '') in ('parking_aisle','driveway','drive-through'): return
        name = way.tags.get('name:zh', way.tags.get('name', ''))[:200]
        # Unnamed sidewalks/trails are not street centre lines. Named walking
        # streets remain eligible; retain genuine unnamed service/residential lanes.
        if way.tags.get('highway') in ('footway', 'path') and not any(token in name for token in ('街','路','巷','弄')): return
        try:
            points = [(node.lon, node.lat) for node in way.nodes]
            if len(points) < 2: return
            xs, ys = zip(*points)
            if max(xs)<BBOX[0] or min(xs)>BBOX[2] or max(ys)<BBOX[1] or min(ys)>BBOX[3]: return
            line = LineString(points).intersection(box(*BBOX))
        except (RuntimeError, ValueError): return
        parts = [line] if line.geom_type == 'LineString' else list(line.geoms) if line.geom_type == 'MultiLineString' else []
        for index, part in enumerate(parts):
            # <= ~1 m simplification follows mapped geometry; no extrapolation.
            coords = list(part.simplify(0.000008, preserve_topology=True).coords)
            if len(coords) < 2: continue
            # Split long ways rather than discard genuine road vertices.
            for start in range(0, len(coords)-1, 511):
                key = f'w{way.id}:{index}:{start}'
                self.roads[key] = dict(id=key, name=name,
                    highway=way.tags.get('highway'), polyline=encode_line(coords[start:start+512]))
                if len(self.roads) > 60000: raise ValueError('Road extract exceeds 60000 segment budget')

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
    handler.apply_file(sys.argv[1], locations=True, idx='flex_mem',
        filters=[osmium.filter.KeyFilter('amenity','shop','leisure','highway','railway')])
    if len(handler.points) < 10: raise ValueError('Empty/incomplete extract; preserve existing inventory')
    # Use Geofabrik extract timestamp, not import time, as data freshness.
    header = osmium.io.Reader(sys.argv[1]).header()
    timestamp = header.get('osmosis_replication_timestamp') or sys.argv[3]
    if len(handler.roads) < 10: raise ValueError('Empty road extract; preserve existing geometry')
    result = dict(source='https://download.geofabrik.de/asia/taiwan.html',
        sourceUpdatedAt=timestamp, skippedInvalidAreas=handler.skipped_invalid_areas, points=sorted(handler.points.values(), key=lambda p: p['id']))
    result['roads'] = sorted(handler.roads.values(), key=lambda r: r['id'])
    with open(sys.argv[2], 'w', encoding='utf-8') as output:
        json.dump(result, output, ensure_ascii=False, separators=(',', ':'))
    print(json.dumps(dict(pointCount=len(handler.points), roadCount=len(handler.roads), sourceUpdatedAt=timestamp, skippedInvalidAreas=handler.skipped_invalid_areas)))
