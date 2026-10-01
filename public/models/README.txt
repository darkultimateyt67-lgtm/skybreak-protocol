DROP-IN 3D MODELS
=================

Put .glb files in this folder and they replace the generated vehicles.
Leave it empty and the game uses its built-in procedural bodies — nothing
breaks either way.

FILE NAMES (must match exactly, lowercase, .glb)
------------------------------------------------
Cars      sedan.glb  coupe.glb  sport.glb  muscle.glb  suv.glb
          pickup.glb  van.glb  truck.glb  bus.glb  bike.glb
Aircraft  prop.glb   jet.glb   heli.glb
Boats     jetski.glb speedboat.glb  launch.glb  yacht.glb

So sport.glb replaces every sport-chassis car in the city.

WHAT GETS HANDLED FOR YOU
-------------------------
- Scale. Models arrive in metres, centimetres, or whatever the artist used.
  Yours is rescaled to the length the game expects, so physics and cameras
  keep working.
- Centring. The model is centred and sat on the ground automatically.
- Orientation. If it was built nose-along-X it gets turned to face forward.
- Shadows are switched on for every mesh.

Wheels, interior and the driver are still added by the game on top, so the
cockpit camera has a steering wheel to look at.

WHERE TO GET MODELS (free, permissive licences)
-----------------------------------------------
- Quaternius        quaternius.com          CC0, game-ready, low poly
- Kenney            kenney.nl/assets        CC0, huge vehicle packs
- Poly Haven        polyhaven.com/models    CC0, photoscanned
- Sketchfab         sketchfab.com  -> filter Downloadable + CC licence

Check the licence on anything you download. CC0 is unrestricted. CC-BY needs
you to credit the author. Avoid anything modelled on a real manufacturer's
car if you plan to publish — car makers do enforce their designs.

Export from Blender: File > Export > glTF 2.0 (.glb), tick +Y up.
