# Satellite display models

NASA assets are credited to NASA / NASA-3D-Resources, pinned to repository commit
`11ebb4ee043715aefbba6aeec8a61746fad67fa7`:

- ISS: `3D Models/International Space Station (ISS) (A)/International Space Station (ISS) (A).glb`
- Hubble: `3D Models/Hubble Space Telescope (A)/Hubble Space Telescope (A).glb`
- Terra: `3D Models/Terra/Terra.glb`

Repository: https://github.com/nasa/NASA-3D-Resources/tree/11ebb4ee043715aefbba6aeec8a61746fad67fa7
Usage guidance: https://www.nasa.gov/nasa-brand-center/images-and-media/
The repository README makes these assets available free and without copyright;
NASA attribution is retained. This project does not imply NASA endorsement.

Tiangong is Earth Atlas's original procedural T-configuration **schematic**,
generated with `video/cinematic/tiangong_model.py`: Tianhe with its section
changes, Wentian and Mengtian with radiators and segmented flexible arrays, a
Tianzhou aft and a Shenzhou at the nadir port. It is not an engineering
replica, official model, current docking configuration or observed attitude.

All four assets are recentered and uniformly normalized by
`scripts/prepare-satellite-models.py` before use. Geometry is preserved. Terra's
unavailable external TGA texture references were removed; original material
colors remain, so Terra is explicitly marked as having simplified materials.
No substitute texture or invented instrument geometry was added.

To keep downloads small (about 0.6 MB for all four, from about 4 MB): Hubble
keeps only its WebP textures (the file also carried same-size PNG copies as a
fallback, now dropped, so `EXT_texture_webp` is required), and Terra and
Tiangong are Draco-compressed with glTF Transform, as the ISS and Hubble files
already were.

`manifest.json` records original and delivered SHA-256 hashes, sizes and exact
normalization transforms. Given copies of the NASA originals in a directory
named by satellite ID (`iss.glb`, `hubble.glb`, `terra.glb`; Tiangong is
generated), rebuild with (Node.js needed for the Draco step):

```
python scripts/prepare-satellite-models.py SOURCE_DIRECTORY
```

Models are display aids: scale and orientation are approximate. SGP4/CelesTrak
supplies the position, not spacecraft attitude or solar-panel articulation.
Selecting a supported target opens model close-up directly. The orbit-view button
returns to the lightweight marker view. Only a tracked spacecraft within 50 km loads a model; it is released beyond
75 km, on target change, disabled satellite layer, stale orbit or stopped tracking.
Ordinary browsing and recording-mode model APIs remain separate.
NOAA-20 and Landsat 9 retain icons until matching verified assets are available.
