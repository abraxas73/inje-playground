class JiraBriefingIssue {
  const JiraBriefingIssue({required this.key, required this.summary, required this.status, this.dueDate});
  final String key, summary, status;
  final String? dueDate;
  factory JiraBriefingIssue.parse(Map<String, dynamic> j) => JiraBriefingIssue(key: j['key'] as String? ?? '', summary: j['summary'] as String? ?? '', status: j['status'] as String? ?? '', dueDate: j['dueDate'] as String?);
}
class JiraBriefing {
  const JiraBriefing({required this.connected, this.reconnect = false, this.items = const [], this.hasMore = false});
  final bool connected, reconnect, hasMore;
  final List<JiraBriefingIssue> items;
  factory JiraBriefing.parse(dynamic raw) {
    final j = raw as Map<String, dynamic>;
    return JiraBriefing(connected: j['connected'] == true, items: [for (final item in j['items'] as List? ?? const []) JiraBriefingIssue.parse(item as Map<String, dynamic>)], hasMore: j['nextPageToken'] != null);
  }
}
