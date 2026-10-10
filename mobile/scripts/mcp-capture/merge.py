import json, sys, os
flows, log_path, out_dir = sys.argv[1:4]; os.makedirs(out_dir, exist_ok=True)
calls = sorted(json.load(open(flows)), key=lambda c: c['t']); log = json.load(open(log_path))
for rec in log:
    mine = [c for c in calls if rec['t0'] <= c['t'] <= rec['t1']]
    json.dump({'tool': rec['tool'], 'args': rec['args'], 'toolResult': rec['result'], 'isError': rec.get('isError'), 'calls': [{k: v for k, v in c.items() if k != 't'} for c in mine]}, open(os.path.join(out_dir, rec['label'] + '.json'), 'w'), ensure_ascii=False, indent=1)
    print(f"{rec['label']}: {len(mine)} -> {[c['path'] for c in mine]}")
