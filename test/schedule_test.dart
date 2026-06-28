import 'dart:convert';
import 'dart:io';
import 'package:test/test.dart';
import 'package:lair/src/models/models.dart';

void main() {
  final scheduleDir = Directory('schedules');

  group('Schedule Datetime & Schema Tests', () {
    // Locate all json schedule files, ignoring manifest.json
    final files = scheduleDir
        .listSync(recursive: true)
        .whereType<File>()
        .where((file) => file.path.endsWith('.json') && !file.path.contains('manifest.json'))
        .toList();

    for (final file in files) {
      test('File: ${file.path} parses correctly and has valid offsets', () {
        final content = file.readAsStringSync();
        
        // 1. Verify it parses successfully into the app's models
        final List<CampEvent> events = CampEvent.fromRawJson(content);
        expect(events, isNotEmpty);

        for (final event in events) {
          // 2. Verify startTime offset is PDT (-07:00)
          if (!event.isAllDay) {
            expect(
              event.startTime,
              endsWith('-07:00'),
              reason: 'Event "${event.title}" (ID: ${event.id}) has invalid startTime offset.',
            );
          }

          // 3. Verify endTime offset is PDT (-07:00)
          if (event.endTime != null) {
            expect(
              event.endTime,
              endsWith('-07:00'),
              reason: 'Event "${event.title}" (ID: ${event.id}) has invalid endTime offset.',
            );
          }
        }
      });
    }
  });

  group('Manifest Validation Tests', () {
    test('manifest.json is valid and referenced schedules exist', () {
      final manifestFile = File('schedules/manifest.json');
      expect(manifestFile.existsSync(), true);

      final content = manifestFile.readAsStringSync();
      final manifest = Manifest.fromJson(json.decode(content) as Map<String, dynamic>);

      expect(manifest.camps, isNotEmpty);
      expect(manifest.schedules, isNotEmpty);

      for (final schedule in manifest.schedules) {
        final file = File('schedules/${schedule.file}');
        expect(
          file.existsSync(),
          true,
          reason: 'Schedule file "${schedule.file}" listed in manifest.json does not exist.',
        );
      }
    });
  });
}
