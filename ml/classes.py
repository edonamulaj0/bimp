import re
# Detector classes and how CubiCasa5K annotation classes map to them (checked against the challenge's answers).
NAMES = ['window', 'door', 'toilet', 'sink', 'shower_bath']
def cat(c):
    if c.startswith('Window'): return 'windows'
    if c.startswith('Door') and not c.startswith('Door None'): return 'doors'  # "Door None" = open doorway, no leaf
    if c == 'FixedFurniture Toilet': return 'toilets'
    if re.match(r'FixedFurniture \w*Sink(Left|Right)?$', c): return 'sinks'  # Sink, DoubleSink, RoundSink, CornerSink, SideSink…; a double bowl is one
    if re.match(r'FixedFurniture (Shower|Bathtub|BathtubRound)$', c): return 'wet'  # ShowerCab is the enclosure of a Shower
    return None
CLASS_ID = {'windows': 0, 'doors': 1, 'toilets': 2, 'sinks': 3, 'wet': 4}
