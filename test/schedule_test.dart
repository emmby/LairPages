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
        final schedule = ScheduleData.fromRawJson(content);
        expect(schedule.tracks, isNotEmpty);

        // Find the earliest event start time to establish the week's boundary
        DateTime? earliestTime;
        for (final track in schedule.tracks) {
          for (final event in track.events) {
            final t = DateTime.parse(event.startTime).toUtc();
            if (earliestTime == null || t.isBefore(earliestTime)) {
              earliestTime = t;
            }
          }
        }

        DateTime? weekStart;
        DateTime? weekEnd;
        if (earliestTime != null) {
          // Check-in is Saturday. We set start bounds to Saturday 00:00:00 UTC
          weekStart = DateTime.utc(earliestTime.year, earliestTime.month, earliestTime.day);
          // And end bounds to Saturday 24:00:00 UTC of the following week (8 days later, exclusive)
          weekEnd = weekStart.add(const Duration(days: 8));
        }

        final seenIds = <String>{};
        final seenTitleTimes = <String>{};

        for (final track in schedule.tracks) {
          expect(track.name, isNotEmpty);

          DateTime? previousTime;
          for (final event in track.events) {
            expect(event.trackName, equals(track.name));

            final currentTime = DateTime.parse(event.startTime).toUtc();

            // A. Date Range Boundary Validation
            if (weekStart != null && weekEnd != null) {
              expect(
                (currentTime.isAfter(weekStart) || currentTime.isAtSameMomentAs(weekStart)) &&
                    currentTime.isBefore(weekEnd),
                true,
                reason: 'Event "${event.title}" (time: ${event.startTime}) falls outside the week boundaries ($weekStart to $weekEnd).',
              );
            }

            // B. Chronological Order Validation
            if (previousTime != null) {
              expect(
                currentTime.isAfter(previousTime) || currentTime.isAtSameMomentAs(previousTime),
                true,
                reason: 'Event "${event.title}" (startTime: ${event.startTime}) is out of chronological order in track "${track.name}".',
              );
            }
            previousTime = currentTime;

            // C. Temporal Logic Validation
            if (event.endTime != null) {
              final endTime = DateTime.parse(event.endTime!).toUtc();
              expect(
                endTime.isAfter(currentTime),
                true,
                reason: 'Event "${event.title}" (ID: ${event.id}) has endTime equal to or before startTime.',
              );
              expect(
                endTime.difference(currentTime).inHours <= 28,
                true,
                reason: 'Event "${event.title}" (ID: ${event.id}) has an implausibly long duration (${endTime.difference(currentTime).inHours} hours).',
              );
            }

            // D. Duplicate Event Prevention
            expect(
              seenIds.add(event.id),
              true,
              reason: 'Duplicate event ID "${event.id}" found in track "${track.name}".',
            );
            
            final uniqueKey = '${track.name}_${event.title}_${event.startTime}';
            expect(
              seenTitleTimes.add(uniqueKey),
              true,
              reason: 'Duplicate event "${event.title}" at time ${event.startTime} found in track "${track.name}".',
            );

            // E. Text Cleanliness & Formatting Checks
            expect(
              event.title.trim(),
              equals(event.title),
              reason: 'Event "${event.title}" has leading/trailing whitespaces.',
            );
            expect(
              event.title.contains('\n'),
              false,
              reason: 'Event "${event.title}" has newlines in its title.',
            );

            // F. Verify timezone offset is PDT (-07:00)
            if (!event.isAllDay) {
              expect(
                event.startTime,
                endsWith('-07:00'),
                reason: 'Event "${event.title}" (ID: ${event.id}) has invalid startTime offset.',
              );
            }

            if (event.endTime != null) {
              expect(
                event.endTime,
                endsWith('-07:00'),
                reason: 'Event "${event.title}" (ID: ${event.id}) has invalid endTime offset.',
              );
            }
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
