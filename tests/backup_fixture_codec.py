from __future__ import annotations
import json
from pathlib import Path

ORDER=("profiles","nodes","units","studyEvents","obligations","evidenceEvents","chunks","dailyPlans","settings","activeRetrieval")
TARGET=512*1024
MAX_ITEMS=100

def compact(value): return json.dumps(value,separators=(",",":"),ensure_ascii=False)
def fnv(data:bytes)->str:
    h=0xcbf29ce484222325
    for b in data:
        h^=b; h=(h*0x100000001b3)&0xffffffffffffffff
    return f"{h:016x}"
def encode_payload(payload:dict)->bytes:
    collections={k:([payload[k]] if k=="settings" else ([payload[k]] if k=="activeRetrieval" and payload.get(k) else [] if k=="activeRetrieval" else payload[k])) for k in ORDER}
    counts={k:len(collections[k]) for k in ORDER}
    bodies=[]
    for entity in ORDER:
        group=[]; total=0
        def flush():
            nonlocal group,total
            if group:
                bodies.append({"kind":"chunk","sequence":len(bodies),"entityType":entity,"count":len(group),"items":group})
                group=[]; total=0
        for item in collections[entity]:
            size=len(compact(item).encode())
            if group and (len(group)>=MAX_ITEMS or total+size>TARGET): flush()
            group.append(item); total+=size
        flush()
    stable={"format":payload["format"],"schemaVersion":payload["schemaVersion"],"profiles":payload["profiles"],"nodes":payload["nodes"],"units":payload["units"],"studyEvents":payload["studyEvents"],"obligations":payload["obligations"],"evidenceEvents":payload["evidenceEvents"],"chunks":payload["chunks"],"dailyPlans":payload["dailyPlans"],"settings":payload["settings"],"activeRetrieval":payload.get("activeRetrieval")}
    manifest={"kind":"manifest","format":"revision-director-backup-archive","version":2,"exportedAt":payload["exportedAt"],"appVersion":payload["appVersion"],"payloadFormat":"revision-director-backup","payloadSchemaVersion":2,"compression":"none","hashAlgorithm":"fnv1a64","chunkTargetBytes":TARGET,"chunkMaxItems":MAX_ITEMS,"chunkCount":len(bodies),"counts":counts,"stateChecksum":fnv(compact(stable).encode())}
    chunks=[]; hashes=[]
    for body in bodies:
        checksum=fnv(compact(body).encode()); hashes.append(checksum); chunks.append({**body,"checksum":checksum})
    completion_body={"kind":"complete","chunkCount":len(chunks),"counts":counts,"chunkHashes":hashes}
    completion={**completion_body,"checksum":fnv(compact({"manifest":manifest,**completion_body}).encode())}
    return ("\n".join(compact(x) for x in [manifest,*chunks,completion])+"\n").encode()

def encode_file(source:Path,target:Path)->None:
    payload=json.loads(source.read_text())
    target.write_bytes(encode_payload(payload))

if __name__=='__main__':
    import sys
    encode_file(Path(sys.argv[1]),Path(sys.argv[2]))

def decode_file(path:Path)->dict:
    raw=path.read_bytes()
    if raw[:2]==b'\x1f\x8b':
        import gzip
        raw=gzip.decompress(raw)
    lines=[json.loads(line) for line in raw.decode('utf-8').splitlines() if line.strip()]
    manifest=lines[0]
    collections={k:[] for k in ORDER}
    for line in lines[1:-1]:
        if line.get('kind')=='chunk': collections[line['entityType']].extend(line['items'])
    return {"format":manifest["payloadFormat"],"schemaVersion":manifest["payloadSchemaVersion"],"exportedAt":manifest["exportedAt"],"appVersion":manifest["appVersion"],**{k:collections[k] for k in ORDER if k not in ('settings','activeRetrieval')},"settings":collections['settings'][0],"activeRetrieval":collections['activeRetrieval'][0] if collections['activeRetrieval'] else None}
