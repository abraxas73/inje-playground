"""예시: 결재선 저장(A05 형식) → 외근신청 상신 → purge 취소 → 임시 삭제 → 라인 삭제.
사전 준비: 아마란스 웹 개인결재라인설정에서 결재자 1명짜리 라인을 만들고 그 lineId를 UI_LINE_ID에 넣는다(결재자에게 상신·취소 알림이 가므로 사용자 승인 뒤에만 실행)."""
UI_LINE_ID = int(__import__("os").environ.get("UI_LINE_ID", "0"))
import json, os, datetime
from driver import call, finish  # CAP_OUT·CAP_LOG·CAP_PROXY 환경변수로 출력 폴더·로그·프록시 지정
who = call('whoami', {})
rd = call('read_approval_line', {'line_id': UI_LINE_ID}, 'read_approval_line-ui')
members = rd.get('members') if isinstance(rd, dict) else None
print('UI 라인 멤버 수:', len(members or []))
sv = call('save_approval_line', {'line_nm': '[테스트] MCP 상신 캡처', 'form_id': 41, 'line_id': 0, 'detail_line_json': json.dumps(members, ensure_ascii=False)}, 'save_approval_line-3c')
line_id = sv.get('createdLineId') if isinstance(sv, dict) else None
rd2 = call('read_approval_line', {'line_id': line_id}, 'read_approval_line-3c') if line_id else {}
print('저장 라인 멤버 수:', len((rd2.get('members') if isinstance(rd2, dict) else None) or []))
use_line = line_id if (isinstance(rd2, dict) and rd2.get('members')) else UI_LINE_ID
guide = call('get_approval_submission_guide', {'doc_type': '41'}, 'get_approval_submission_guide-41-3c')
dh = guide['guide']['draftHelp']
day = '20261216'; hp = json.loads(json.dumps(dh['hpApplicationExample'])); bd = json.loads(json.dumps(dh['bindDataExample']))
for a in hp['applicationList']:
    a.update({'atDt': day, 'startDt': day, 'endDt': day, 'appRmkDc': '[테스트] MCP 캡처(즉시 취소)', 'taskDc': 'MCP 커넥터 상신 캡처 — 즉시 취소'})
bd['ITEMS'] = {'appYear': '2026', 'appMonth': '10', 'appDay': datetime.date.today().strftime('%d')}
for g in bd['TABLE']['dbTable1']['group']:
    for gg in g['group']:
        gg['items'].update({'startDt': '2026-12-16', 'endDt': '2026-12-16', 'appRmkDc': '[테스트] MCP 캡처(즉시 취소)', 'taskDc': 'MCP 커넥터 상신 캡처 — 즉시 취소'})
sub = call('submit_approval', {'form_id': 41, 'doc_title': '[외근신청] 12/16 종일외근_테스트(즉시취소)', 'line_id': use_line, 'hp_application_json': json.dumps(hp, ensure_ascii=False), 'bind_data_json': json.dumps(bd, ensure_ascii=False), 'doc_contents_html': '<div>2026-12-16 종일외근 — MCP 캡처 테스트(즉시 취소)</div>', 'numbering_id': ''})
doc = (sub.get('docId') or sub.get('doc_id')) if isinstance(sub, dict) else None
if doc:
    call('list_approvals', {'box_name': 'sent', 'page_size': 3}, 'list_approvals-sent-after-submit')
    call('read_approval', {'doc_id': doc, 'form_id': 41}, 'read_approval-after-submit')
    call('cancel_approval', {'doc_id': doc, 'form_id': 41, 'purge': True})
    call('list_approvals', {'box_name': 'sent', 'page_size': 3}, 'list_approvals-sent-after-cancel')
    dr = call('list_approvals', {'box_name': 'draft', 'page_size': 5}, 'list_approvals-draft-after-cancel')
    left = [str(d.get('docId')) for d in (dr.get('documents') or []) if '[외근신청] 12/16' in str(d.get('title') or '')] if isinstance(dr, dict) else []
    print('임시 잔여:', left)
    if left: call('delete_temp_approval', {'doc_ids': ','.join(left)})
    else:
        # 임시보관 삭제 흐름도 캡처: 임시 문서가 없으면 건너뜀(별도 임시 저장 도구가 없음)
        pass
else:
    print('상신 결과:', json.dumps(sub, ensure_ascii=False)[:600])
lines = call('list_approval_lines', {}, 'list_approval_lines-3c')
for r in (lines.get('lines') or []):
    if str(r.get('lineId')) in (str(line_id), str(UI_LINE_ID)) and r.get('_row'):
        call('delete_approval_line', {'row_json': json.dumps(r['_row'], ensure_ascii=False)}, f"delete_approval_line-3c-{r.get('lineId')}")
finish()
