# Administrative aliases in saved streets

Library cards group recognisable street names within the same known city after
removing administrative prefixes/suffixes and normalising whitespace, full-width
characters and 台/臺. For example, 永康街, 大安區永康街 and 臺北市大安區永康街
share a card. Sections, lanes, alleys and address suffixes remain distinct.
Different recognised streets are not joined even at an intersection.

If city metadata is missing, matching names require coordinates within 35m;
the code does not assume a same-named road elsewhere is the same street.
Existing exact-coordinate non-road naming aliases still group locally.

This is a client-side display change. Every visit retains its original ID,
coordinate, timestamp, CLS, notes and evidence/photo keys. The existing card
chooses its latest completed score; expanding history opens each original visit.
No database migration, cleanup, score averaging or full-history fetch is added.

Legacy favourite keys are recognised through the same aliases. Initial loading
does not create a duplicate pending record merely because a favourite includes
the district. Unfavouriting removes matching alias keys without deleting visits.
The write-time field-record merge policy remains unchanged.

Regression tests cover administrative aliases, city isolation, intersections,
missing-city proximity, lanes, zero/unchanged CLS, all original records/evidence,
legacy favourite migration, filtering, unfavouriting and reload preservation.
