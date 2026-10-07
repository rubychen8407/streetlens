"""Synthetic fixtures verify extraction only; they never enter application data."""
import importlib.util
import tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('extract', Path(__file__).with_name('extract-static-osm.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert module.classify({'leisure': 'park'}) == 'park'
assert module.classify({'shop': 'convenience'}) == 'convenience'
assert module.classify({'name': 'Unclassified business'}) is None
fixture = '''<osm version="0.6">
<node id="1" lat="25.03" lon="121.56"><tag k="shop" v="supermarket"/><tag k="name" v="Test fixture"/></node>
<node id="2" lat="25.03" lon="121.57"/>
<node id="3" lat="25.04" lon="121.57"/>
<node id="4" lat="25.04" lon="121.56"/>
<node id="5" lat="0" lon="0"><tag k="shop" v="supermarket"/></node>
<way id="6"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="leisure" v="park"/></way>
<way id="7"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="residential"/><tag k="name" v="Test street"/></way>
<way id="8"><nd ref="5"/><nd ref="2"/><tag k="highway" v="service"/></way>
<way id="9"><nd ref="1"/><nd ref="2"/><tag k="highway" v="service"/><tag k="service" v="parking_aisle"/></way>
<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="footway"/></way>
</osm>'''
with tempfile.TemporaryDirectory() as folder:
    path = Path(folder) / 'fixture.osm'
    path.write_text(fixture)
    handler = module.Extract()
    handler.apply_file(str(path), locations=True, idx='flex_mem',
        filters=[module.osmium.filter.KeyFilter('amenity','shop','leisure','highway','railway')])
    assert set(handler.points) == {'n1', 'w6'}, handler.points
    assert handler.points['w6']['properties']['coordinateMethod'] == 'polygon_representative_point'
    assert 25.03 < handler.points['w6']['lat'] < 25.04
    assert 121.56 < handler.points['w6']['lng'] < 121.57
    assert handler.roads['w7:0:0']['name'] == 'Test street'
    assert handler.roads['w8:0:0']['name'] == '', 'unnamed mapped lanes keep their real unnamed identity'
    assert 'w9:0:0' not in handler.roads and 'w10:0:0' not in handler.roads, 'parking aisles and unnamed sidewalks are not streets'
    assert handler.roads['w7:0:0']['polyline'] == module.encode_line([(121.56,25.03),(121.57,25.03),(121.57,25.04)])
print('Static OSM extraction passed: real geometry handling, derived polygon points, outside-area filtering.')

from types import SimpleNamespace
broken = module.Extract()
def invalid_geometry(area): raise RuntimeError('Invalid upstream area')
broken.factory = SimpleNamespace(create_multipolygon=invalid_geometry)
broken.area(SimpleNamespace(tags={'leisure': 'park'}))
assert broken.skipped_invalid_areas == 1
assert not broken.points
