/// Calendar and verified unread mail from the device-local Dooray web session.
class DoorayBriefingItem {
  const DoorayBriefingItem({required this.subject, required this.detail});
  final String subject, detail;
}

class DoorayBriefing {
  const DoorayBriefing({
    this.connected = false,
    this.events = const [],
    this.mail = const [],
    this.eventsError,
    this.mailError,
    this.refreshError,
    this.partial = false,
  });
  final bool connected, partial;
  final List<DoorayBriefingItem> events, mail;
  final String? eventsError, mailError, refreshError;
  bool get visible =>
      connected &&
      (events.isNotEmpty ||
          mail.isNotEmpty ||
          eventsError != null ||
          mailError != null ||
          refreshError != null);

  static DoorayBriefing parse(dynamic raw) {
    if (raw is! Map || raw['connected'] != true) return const DoorayBriefing();
    final events = raw['events'] is Map ? raw['events'] as Map : const {};
    final mail = raw['mail'] is Map ? raw['mail'] as Map : const {};
    String? error(Map source) =>
        source['error'] is String && (source['error'] as String).isNotEmpty
        ? source['error'] as String
        : null;
    List<DoorayBriefingItem> items(Map source, bool calendar) => [
      for (final x
          in source['items'] is List ? source['items'] as List : const [])
        if (x is Map &&
            x['subject'] is String &&
            (calendar || x['unread'] == true))
          DoorayBriefingItem(
            subject: x['subject'] as String,
            detail: calendar
                ? x['wholeDayFlag'] == true
                      ? '종일'
                      : _time(x['startedAt'])
                : [
                    if (x['from'] is String && (x['from'] as String).isNotEmpty)
                      x['from'] as String,
                    _time(x['sentAt']),
                  ].where((s) => s.isNotEmpty).join(' · '),
          ),
    ];
    return DoorayBriefing(
      connected: true,
      events: items(events, true),
      mail: items(mail, false),
      eventsError: error(events),
      mailError: error(mail),
      partial: mail['partial'] == true,
    );
  }
}

String _time(dynamic raw) {
  if (raw is! String) return '';
  final date = DateTime.tryParse(raw);
  if (date == null) return '';
  final kst = date.toUtc().add(const Duration(hours: 9));
  String two(int n) => n.toString().padLeft(2, '0');
  return '${kst.month}/${kst.day} ${two(kst.hour)}:${two(kst.minute)}';
}
