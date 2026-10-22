"""Independently recompute frame and snapshot hashes for a recovered film.
Usage: verify_recovery.py RECOVERED_FRAMES ORIGINAL_ARTIFACTS PLAN_DIR
"""
import hashlib
import json
import sys
from pathlib import Path


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(output, original, plan_dir):
    output, original, plan_dir = map(Path, (output, original, plan_dir))
    recovery = json.loads((output / 'recovery.json').read_text(encoding='utf-8'))
    capture = json.loads((output / 'capture-recovered.json').read_text(encoding='utf-8'))
    plan = json.loads((plan_dir / 'plan.json').read_text(encoding='utf-8'))
    assert recovery['planSha256'] == sha(plan_dir / 'plan.json')
    assert recovery['T0'] == plan['T0'] == capture['plan']['T0']
    assert plan['station']['noradId'] == 48274 and plan['region']['id'] == 'middle-east'
    for entry in recovery['snapshotFiles']:
        assert Path(entry['file']).name == entry['file']
        assert sha(plan_dir / 'data' / entry['file']) == entry['sha256']
    originals = {}
    for report_path in original.rglob('capture-*.json'):
        report = json.loads(report_path.read_text(encoding='utf-8'))
        assert report['plan']['T0'] == plan['T0']
        for entry in report['frames']:
            assert entry['frame'] not in originals
            originals[entry['frame']] = (entry, report_path.parent / entry['file'])
    assert len(originals) == len(capture['frames']) == len(recovery['frames']) == 900
    repaired = set(recovery['repairedFrames'])
    assert repaired == {i for i, (entry, _) in originals.items() if not entry['settled']}
    for index, (entry, lineage) in enumerate(zip(capture['frames'], recovery['frames'])):
        assert entry['frame'] == lineage['frame'] == index and entry['settled'] is True
        before, path = originals[index]
        assert entry['t'] == before['t'] == index / 30 and entry['camera'] == before['camera']
        assert sha(path) == lineage['originalSha256']
        assert sha(output / entry['file']) == lineage['sha256']
        assert lineage['repaired'] == (index in repaired)
        if index not in repaired:
            assert lineage['sha256'] == lineage['originalSha256']
    assert capture['unsettled'] == 0 and not capture['missing']
    print(json.dumps({'frames':900,'repaired':sorted(repaired),'unsettled':0,'hashes':'verified','camera_and_time':'unchanged','source_warning_count':sum(len(w['errors']) for w in recovery.get('sourceWarnings',[]))}))


if __name__ == '__main__':
    verify(*sys.argv[1:])
