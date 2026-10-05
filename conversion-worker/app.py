"""Optional authenticated conversion worker. Never deployed by Vercel itself."""
from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel
from tempfile import TemporaryDirectory
from pathlib import Path
import os, secrets, base64, subprocess, threading
app=FastAPI()
limit=threading.BoundedSemaphore(2)
class Payload(BaseModel):
    action:str
    file:str

def authorized(auth):
    expected=os.getenv('CONVERSION_SERVICE_TOKEN','')
    if not expected or not secrets.compare_digest(auth or '', 'Bearer '+expected):
        raise HTTPException(401,'Unauthorized')

@app.post('/process')
async def process(request:Request,authorization:str|None=Header(default=None)):
    authorized(authorization)
    body=await request.body()
    if len(body)>4*1024*1024:raise HTTPException(413,'Request too large')
    data=Payload.model_validate_json(body)
    if data.action not in ('pdfa','searchable'):raise HTTPException(400,'Unsupported operation')
    try:raw=base64.b64decode(data.file,validate=True)
    except Exception:raise HTTPException(400,'Invalid PDF')
    if len(raw)>int(2.8*1024*1024) or not raw.startswith(b'%PDF-'):raise HTTPException(400,'Invalid PDF or file too large')
    if not limit.acquire(blocking=False):raise HTTPException(429,'Worker busy')
    try:
        with TemporaryDirectory(prefix='bdf-') as tmp:
            source=Path(tmp)/'input.pdf';target=Path(tmp)/'output.pdf';source.write_bytes(raw)
            command=['ocrmypdf','--output-type','pdfa-2','--skip-text','--optimize','1','--jobs','1']
            if data.action=='searchable':command+=['-l','ara+eng']
            else:command+=['--ocr-engine','none']
            command += [str(source),str(target)]
            subprocess.run(command,check=True,timeout=45,capture_output=True)
            content=target.read_bytes()
            if len(content)>int(2.8*1024*1024):raise HTTPException(413,'Output too large')
            return {'file':base64.b64encode(content).decode()}
    except (subprocess.CalledProcessError,subprocess.TimeoutExpired):raise HTTPException(422,'Conversion failed')
    finally:limit.release()
