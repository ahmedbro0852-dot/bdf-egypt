"""Bounded recovery for provider transport and malformed review responses."""
import json
import socket
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

class ReviewFailure(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)

def parse_review(result, require_coverage=True):
    choices = result.get('choices') if isinstance(result, dict) else None
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ReviewFailure('empty_response')
    choice = choices[0]
    if choice.get('finish_reason') == 'length':
        raise ReviewFailure('truncated_response')
    message = choice.get('message') or {}
    raw = message.get('content') if isinstance(message, dict) else None
    if isinstance(raw, list):
        raw = ''.join(x.get('text', '') for x in raw if isinstance(x, dict) and isinstance(x.get('text'), str))
    if not isinstance(raw, str) or not raw.strip():
        raise ReviewFailure('empty_response')
    # Decode one object without joining unrelated braces or accepting trailing JSON.
    raw = raw.strip()
    if raw.startswith('```'):
        raw = raw.split('\n', 1)[-1].rsplit('```', 1)[0].strip()
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        raise ReviewFailure('invalid_json')
    if not isinstance(parsed, dict) or not isinstance(parsed.get('fields'), list) or not parsed['fields'] or (require_coverage and not isinstance(parsed.get('coverage'), dict)):
        raise ReviewFailure('invalid_schema')
    return parsed

def parse_candidates(result):
    return parse_review(result, require_coverage=False)

def request_review(base, key, payload, opener=None, parser=parse_review, retry_instruction=None, deadline=None):
    opener = opener or urlopen
    last = None
    for attempt, timeout in enumerate((60, 45)):
        if deadline is not None:
            timeout=min(timeout,deadline-time.monotonic())
            if timeout<2:raise ReviewFailure('provider_timeout')
        body = dict(payload)
        if attempt:
            body['max_tokens'] = max(body.get('max_tokens', 0), 11000)
            body['messages'] = [*payload['messages'], {'role':'user', 'content':retry_instruction or 'أعد JSON صالحًا كاملًا فقط دون شرح أو markdown، مع fields وcoverage. لا تحذف أي خانة.'}]
        req = Request(base+'/chat/completions', data=json.dumps(body).encode(), headers={'Content-Type':'application/json','Authorization':'Bearer '+key})
        try:
            with opener(req, timeout=timeout) as response:
                result = json.load(response)
            return parser(result)
        except HTTPError as err:
            code = 'provider_auth' if err.code in (401,403) else ('provider_rate_limit' if err.code==429 else 'provider_http')
            last = ReviewFailure(code)
            if err.code < 500 and err.code != 429:
                raise last
        except (TimeoutError, socket.timeout):
            last = ReviewFailure('provider_timeout')
        except URLError:
            last = ReviewFailure('provider_connection')
        except (json.JSONDecodeError, UnicodeDecodeError):
            last = ReviewFailure('invalid_json')
        except ReviewFailure as err:
            last = err
        # Only safe metadata is logged: never documents, keys or provider bodies.
        print(json.dumps({'event':'autofill_review_retry','attempt':attempt+1,'code':last.code}), flush=True)
    raise last

def review_message(code):
    return {
        'provider_timeout':'مزود الذكاء تأخر في التدقيق بعد إعادة المحاولة.',
        'provider_rate_limit':'مزود الذكاء عليه ضغط أو حد استخدام مؤقت.',
        'provider_auth':'إعداد مفتاح مزود الذكاء يحتاج مراجعة من إدارة الموقع.',
        'truncated_response':'مزود الذكاء أوقف تقرير التدقيق قبل اكتماله.',
        'invalid_json':'مزود الذكاء أعاد تقريرًا غير صالح رغم إعادة المحاولة.',
        'invalid_schema':'تقرير التدقيق لم يتضمن الخانات والتغطية المطلوبة.',
        'empty_response':'مزود الذكاء أعاد ردًا فارغًا في التدقيق.',
        'provider_connection':'تعذر الاتصال بمزود الذكاء أثناء التدقيق.',
    }.get(code,'تعذر التدقيق بسبب خطأ من مزود الذكاء.')
