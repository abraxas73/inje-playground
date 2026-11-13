import 'package:flutter_test/flutter_test.dart';
import 'package:playground/directory/org_directory.dart';

const _base = 'https://gw.innogrid.com/gw/contentsImgController/download/';

void main() {
  test('서버 조직도 응답 → 사람 목록(이름 없는 항목은 버림)', () {
    final people = parseOrgPeople({
      'people': [
        {'empSeq': '11', 'name': ' 박석현 ', 'email': 'park@innogrid.com', 'deptName': '플랫폼팀', 'duty': '팀장', 'position': '책임', 'photoPath': 'g/empPic/a_jpg', 'mobile': '010-1234-5678'},
        {'empSeq': '13', 'name': '외부', 'photoPath': 'https://evil.example/a.jpg'},
        {'empSeq': '12', 'name': '', 'email': 'x@innogrid.com'},
        'bad',
      ],
    });
    // 사진 경로 → 아마란스 썸네일·원본 주소, 모양이 틀리면 없음
    expect(people.first, (empSeq: '11', name: '박석현', email: 'park@innogrid.com', dept: '플랫폼팀', duty: '팀장', position: '책임', photo: '${_base}g/empPic/thum_a_jpg', photoLarge: '${_base}g/empPic/a_jpg', mobile: '010-1234-5678'));
    expect(people.map((p) => p.photo).last, '');
    expect(people, hasLength(2));
    expect(parseOrgPeople(null), isEmpty);
  });

  test('아마란스 명부 행의 사진 — 썸네일·원본 주소, 모양이 틀리면 없음', () {
    expect(gwPhotoUrls('gcmsAmaranth31433', '7cdc-11_jpg'), (photo: '${_base}gcmsAmaranth31433/empPic/thum_7cdc-11_jpg', photoLarge: '${_base}gcmsAmaranth31433/empPic/7cdc-11_jpg'));
    expect(gwPhotoUrls('g', ''), (photo: '', photoLarge: ''));
    expect(gwPhotoUrls('../x', 'a'), (photo: '', photoLarge: ''));
  });

  test('phoneMatch — 4자리는 뒷자리, 5자리 이상은 포함, 3자리 이하·글자는 안 봄', () {
    expect(phoneMatch('010-1234-5678', '5678'), isTrue);
    expect(phoneMatch('010-1234-5678', '1234'), isFalse);
    expect(phoneMatch('010-1234-5678', '1234-5'), isTrue);
    expect(phoneMatch('010-1234-5678', '678'), isFalse);
    expect(phoneMatch('010-1234-5678', '김5678'), isFalse);
    expect(phoneMatch('', '5678'), isFalse);
  });
}
