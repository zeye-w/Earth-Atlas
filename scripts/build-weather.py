"""Fetch only three NOAA GFS GRIB messages; export a 1 degree display grid."""
import datetime as dt
import json
import pathlib
import urllib.request
import hashlib
import numpy as np
import eccodes as ec

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com/'

def get(url, headers=None):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=90) as r:
        data = r.read(4_000_001)
        if len(data) > 4_000_000:
            raise ValueError('Response exceeds field size limit')
        if headers and r.status != 206:
            raise ValueError('Server ignored byte range')
        return data

def build():
    now = dt.datetime.now(dt.timezone.utc)
    cycle = (now - dt.timedelta(hours=4)).replace(minute=0, second=0, microsecond=0)
    cycle = cycle.replace(hour=cycle.hour // 6 * 6)
    for attempt in range(8):
        run = cycle - dt.timedelta(hours=6 * attempt)
        url = BASE + run.strftime('gfs.%Y%m%d/%H/atmos/gfs.t%Hz.pgrb2.0p25.f000')
        try:
            lines = get(url + '.idx').decode().splitlines()
            break
        except urllib.error.HTTPError as error:
            if error.code not in (403, 404): raise
    else:
        raise RuntimeError('No recent GFS analysis found')
    if now - run > dt.timedelta(hours=36):
        raise RuntimeError('Latest available analysis is too old')
    fields, provenance = {}, []
    for name, parameter, level, scale in [('temperature', 'TMP', '2 m above ground', 10), ('u', 'UGRD', '10 m above ground', 100), ('v', 'VGRD', '10 m above ground', 100)]:
        index = next(i for i, line in enumerate(lines) if f':{parameter}:{level}:' in line)
        start, end = int(lines[index].split(':')[1]), int(lines[index + 1].split(':')[1]) - 1
        raw = get(url, {'Range': f'bytes={start}-{end}'})
        if len(raw) != end - start + 1 or raw[:4] != b'GRIB' or raw[-4:] != b'7777':
            raise ValueError('Incomplete GRIB field')
        handle = ec.codes_new_from_message(raw)
        try:
            expected = {'Ni':1440, 'Nj':721, 'iScansNegatively':0, 'jScansPositively':0, 'jPointsAreConsecutive':0, 'alternativeRowScanning':0, 'forecastTime':0, 'latitudeOfFirstGridPointInDegrees':90, 'latitudeOfLastGridPointInDegrees':-90, 'longitudeOfFirstGridPointInDegrees':0, 'longitudeOfLastGridPointInDegrees':359.75, 'iDirectionIncrementInDegrees':.25, 'jDirectionIncrementInDegrees':.25, 'numberOfMissing':0}
            for key, value in expected.items():
                if ec.codes_get(handle, key) != value: raise ValueError(f'Unsupported {key}')
            if ec.codes_get(handle, 'gridType') != 'regular_ll': raise ValueError('Unsupported grid')
            if ec.codes_get(handle, 'units') != ('K' if name == 'temperature' else 'm s**-1'): raise ValueError('Unexpected units')
            if name != 'temperature' and ec.codes_get(handle, 'uvRelativeToGrid') != 0: raise ValueError('Wind must be Earth relative')
            if ec.codes_get(handle, 'dataDate') != int(run.strftime('%Y%m%d')) or ec.codes_get(handle, 'dataTime') != run.hour * 100: raise ValueError('Cycle mismatch')
            values = ec.codes_get_values(handle).reshape(721,1440)[::4,::4]
            if name == 'temperature': values = values - 273.15
            if not np.isfinite(values).all() or np.max(np.abs(values)) > 150: raise ValueError('Invalid physical values')
            fields[name] = np.round(values * scale).astype(int).ravel().tolist()
            provenance.append({'field':name, 'range':[start,end], 'sha256':hashlib.sha256(raw).hexdigest()})
        finally:
            ec.codes_release(handle)
    output = dict(version=1, source='NOAA GFS', validTime=run.isoformat(), generatedAt=now.isoformat(), nx=360, ny=181, temperatureScale=0.1, windScale=0.01, sourceUrl=url, messages=provenance, **fields)
    path = ROOT / 'public/data/weather/latest.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output,separators=(',',':')), encoding='utf-8')
    print(f'{path}: {run.isoformat()}, {path.stat().st_size} bytes')

if __name__ == '__main__': build()
