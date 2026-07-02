import 'dart:convert';
import 'dart:io';
import 'package:test/test.dart';
import 'package:lair/src/models/models.dart';

void main() {
  final scheduleDir = Directory('schedules');

  // Read all valid location IDs from Lair maps
  final validLocationIds = <String>{};
  final mapsDir = Directory('../Lair/assets/maps');
  if (!mapsDir.existsSync()) {
    throw StateError(
      'Sibling Lair repository map assets directory does not exist at ${mapsDir.absolute.path}. '
      'Ensure the Lair repository is checked out adjacent to LairPages so location IDs can be validated.',
    );
  }

  final mapFiles = mapsDir.listSync().whereType<File>();
  for (final file in mapFiles) {
    final filename = file.path.split(Platform.pathSeparator).last;
    if (filename.startsWith('locations_') && filename.endsWith('.json')) {
      final campName = filename.substring(10, filename.length - 5);
      final content = file.readAsStringSync();
      final data = json.decode(content) as Map<String, dynamic>;
      final locations = data['locations'] as List<dynamic>? ?? [];
      for (final loc in locations) {
        final locId = loc['id'] as String?;
        if (locId != null && locId.isNotEmpty) {
          validLocationIds.add('$campName/$locId');
        }
      }
    }
  }

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

            // G. Location Markdown Link Validation
            if (event.location != null) {
              final linkRegExp = RegExp(r'maplocation:\/\/([^/)]+)\/([^)]+)');
              final matches = linkRegExp.allMatches(event.location!);
              for (final match in matches) {
                final campId = match.group(1);
                final locationId = match.group(2);
                final fullId = '$campId/$locationId';
                expect(
                  validLocationIds.contains(fullId),
                  true,
                  reason: 'Event "${event.title}" contains link to invalid location ID "$fullId" in location string "${event.location}".',
                );
              }
            }

            // H. Location Casing Validation
            if (event.location != null && event.location!.isNotEmpty) {
              String firstCharStr = event.location!;
              if (firstCharStr.startsWith('[')) {
                firstCharStr = firstCharStr.substring(1);
              }
              if (firstCharStr.isNotEmpty) {
                final firstChar = firstCharStr[0];
                expect(
                  firstChar == firstChar.toUpperCase(),
                  true,
                  reason: 'Event "${event.title}" location string "${event.location}" must start with an uppercase letter.',
                );
              }

              // Ensure all maplocation markdown link labels are capitalized
              final linkLabelRegExp = RegExp(r'\[([^\]]+)\]\(maplocation:\/\/');
              final labelMatches = linkLabelRegExp.allMatches(event.location!);
              for (final match in labelMatches) {
                final label = match.group(1) ?? '';
                if (label.isNotEmpty) {
                  final firstChar = label[0];
                  expect(
                    firstChar == firstChar.toUpperCase(),
                    true,
                    reason: 'Event "${event.title}" markdown link label "$label" in location string must start with an uppercase letter.',
                  );
                }
              }
            }

            // Ensure markdown links in description are also properly capitalized
            if (event.description != null && event.description!.isNotEmpty) {
              final linkLabelRegExp = RegExp(r'\[([^\]]+)\]\(maplocation:\/\/');
              final labelMatches = linkLabelRegExp.allMatches(event.description!);
              for (final match in labelMatches) {
                final label = match.group(1) ?? '';
                if (label.isNotEmpty) {
                  final firstChar = label[0];
                  expect(
                    firstChar == firstChar.toUpperCase(),
                    true,
                    reason: 'Event "${event.title}" markdown link label "$label" in description must start with an uppercase letter.',
                  );
                }
              }
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
