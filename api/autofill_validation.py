"""Validate an AI mapping without silently dropping fields or shortening values."""
import math
import unicodedata

def normalized(value):
    return ' '.join(unicodedata.normalize('NFKC', str(value)).casefold().split())

def validate_mapping(parsed, source, target):
    if not isinstance(parsed, dict):
        raise ValueError('نتيجة التحليل ليست قائمة خانات صالحة.')
    items = parsed.get('fields')
    if not isinstance(items, list) or not 0 < len(items) <= 160:
        raise ValueError('عدد الخانات غير صالح أو يتجاوز ١٦٠ خانة. قسّم النموذج؛ لم يتم حذف خانات.')
    coverage = parsed.get('coverage')
    if not isinstance(coverage, dict) or coverage.get('complete') is not True:
        raise ValueError('التدقيق لم يؤكد اكتمال فحص النموذج.')
    missed = coverage.get('missed_relevant_facts', [])
    if not isinstance(missed, list) or missed:
        raise ValueError('توجد معلومات لها خانات ولم يُحسم نقلها: ' + '، '.join(str(x) for x in missed if isinstance(x, str)))
    fields, seen = [], set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError('نتيجة التحليل تحتوي خانة غير صالحة.')
        if any(not isinstance(item.get(k, ''), str) for k in ('label', 'anchor', 'value', 'source_hint')):
            raise ValueError('قيم الخانات يجب أن تكون نصوصًا.')
        label = item.get('label', '').strip()
        anchor = (item.get('anchor') or label).strip()
        value = item.get('value', '').strip()
        quote = item.get('source_hint', '').strip()
        if not label or not anchor or len(label) > 500 or len(anchor) > 500 or len(value) > 20000 or len(quote) > 20000:
            raise ValueError('خانة فارغة الاسم أو قيمة طويلة جدًا؛ لم يتم قص البيانات.')
        identity = normalized(anchor)
        if identity in seen:
            raise ValueError('تكرر ربط نفس الخانة: ' + label)
        seen.add(identity)
        if normalized(anchor) not in normalized(target):
            raise ValueError('الخانة غير موجودة في النموذج: ' + label)
        if value and (not quote or normalized(quote) not in normalized(source)):
            raise ValueError('مقتطف المصدر غير مثبت للخانة: ' + label)
        try:
            confidence = float(item.get('confidence', 0))
        except (ValueError, TypeError):
            confidence = 0
        if not math.isfinite(confidence):
            confidence = 0
        fields.append({'label': label, 'anchor': anchor, 'value': value,
                       'source_hint': quote, 'confidence': max(0, min(1, confidence))})
    counts = {}
    for key in ('target_fields_checked', 'source_facts_checked'):
        raw = coverage.get(key, 0)
        if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw) or raw < 0:
            raise ValueError('تقرير التغطية غير صالح.')
        counts[key] = int(raw)
    return fields, {'complete': True, **counts, 'missed_relevant_facts': []}
