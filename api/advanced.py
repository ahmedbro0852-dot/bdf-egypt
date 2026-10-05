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
    def do_GET(self):
        # AI remains disabled until a private access token is configured, avoiding public API spend.
        self.respond(200,{'conversion':bool(os.getenv('CONVERSION_SERVICE_URL') and os.getenv('CONVERSION_SERVICE_TOKEN')),'ai':False})
    def do_POST(self):
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<4*1024*1024:return self.respond(413,{'error':'الطلب أكبر من حد الخدمة.'})
            data=json.loads(self.rfile.read(length))
            action=data.get('action')
            if action in ('pdfa','searchable'):
                url=os.getenv('CONVERSION_SERVICE_URL','').rstrip('/')
                token=os.getenv('CONVERSION_SERVICE_TOKEN','')
                if not url or not token:return self.respond(503,{'error':'خدمة التحويل المتقدمة لم تُفعّل بعد.'})
                if not url.startswith('https://'):return self.respond(503,{'error':'يجب ضبط خدمة التحويل باستخدام HTTPS.'})
                req=Request(url+'/process',data=json.dumps({'action':action,'file':data.get('content','')}).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+token})
                with urlopen(req,timeout=50) as response:result=json.load(response)
                return self.respond(200,result)
            if action in ('summarize','translate'):
                return self.respond(503,{'error':'التلخيص والترجمة يحتاجان مزود ذكاء اصطناعي مع تقييد وصول المستخدمين. لم يتم تفعيلهما بعد.'})
            self.respond(400,{'error':'عملية غير مدعومة.'})
        except HTTPError:
            self.respond(502,{'error':'رفض خادم التحويل الملف. تأكد من صلاحيته وعدم وجود كلمة مرور.'})
        except Exception:
            self.respond(502,{'error':'تعذر الاتصال بخدمة المعالجة المتقدمة.'})
    def log_message(self,*args):pass
