from http.server import BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import os, json

class handler(BaseHTTPRequestHandler):
    def respond(self,status,data):
        body=json.dumps(data,ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0 < length <= 8192:
                return self.respond(400,{'error':'invalid_request'})
            data=json.loads(self.rfile.read(length))
            email=str(data.get('email','')).strip().lower()
            password=str(data.get('password',''))
            if '@' not in email or len(email)>320:
                return self.respond(400,{'error':'اكتب بريدًا صحيحًا.'})
            if not 6 <= len(password) <= 128:
                return self.respond(400,{'error':'كلمة المرور لازم تكون 6 أحرف على الأقل.'})

            base=os.getenv('SUPABASE_URL','').rstrip('/')
            secret=os.getenv('BDF_SIGNUP_SECRET','')
            if not base or not secret:
                return self.respond(503,{'error':'خدمة إنشاء الحساب غير مفعلة.'})

            req=Request(
                base+'/functions/v1/bdf-signup',
                data=json.dumps({'email':email,'password':password}).encode('utf-8'),
                headers={
                    'Content-Type':'application/json',
                    'x-bdf-signup-secret':secret
                },
                method='POST'
            )
            try:
                with urlopen(req,timeout=20) as response:
                    result=json.load(response)
                    return self.respond(response.status,result)
            except HTTPError as err:
                try:
                    result=json.loads(err.read().decode('utf-8','ignore') or '{}')
                except Exception:
                    result={}
                status=409 if err.code==409 else 400
                return self.respond(status,result or {'error':'تعذر إنشاء الحساب.'})
        except Exception:
            return self.respond(500,{'error':'تعذر إنشاء الحساب الآن.'})
