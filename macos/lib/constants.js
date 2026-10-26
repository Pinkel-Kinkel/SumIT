'use strict';
// Shared names from the C# partial class (Moodle.cs, Ai.cs, App.cs, ...). Folder names are Hebrew on purpose:
// they are what the student sees in Finder/OneDrive, and must match the Windows version so a course folder
// synced through OneDrive works on both.

const path = require('path');

module.exports = {
  Version: '1.0.14',
  Repo: 'Pinkel-Kinkel/SumIT',
  RepoNames: ['Pinkel-Kinkel/SumIT'],

  Sites: {
    moodle: 'https://md.hit.ac.il/my/',
    portal: 'https://portal.hit.ac.il/',
    cs24: 'https://cs24.co.il/drive?d=e47d12',
    outlook: 'https://outlook.office365.com/mail/',
    onedrive: 'https://hitacil-my.sharepoint.com/_layouts/15/onedrive.aspx',
    notability: 'https://notability.com/',
    notebooklm: 'https://notebooklm.google.com/',
    calendar: 'https://webrashim.hit.ac.il/Portals/student/schedule',
  },

  // Moodle.cs
  MoodleBase: 'https://md.hit.ac.il',
  Exercises: 'תרגילים',
  Exams: 'מבחנים',
  CourseInfoFolder: 'מידע על הקורס',
  General: 'כללי',
  RecordingFolder: 'הקלטה',          // inside a lesson
  LectureRecordings: 'הקלטות',       // course level, "הרצאה N"
  StudyPages: 'דפי לימוד',
  Notebook: 'מחברת תלמיד',           // the student's own notebook (inside a lecture)
  LecturerNotes: 'מחברת מרצה',       // the lecturer's slides and notes (inside a lecture)
  SummaryHtmlName: 'סיכום הרצאה - גרסה אינטראקטיבית.html',
  SummaryPdfName: 'סיכום הרצאה.pdf',
  SumitDir: '.sumit',                // the app's own helper files (digests, logs), hidden
  SummaryName: 'סיכום הרצאה',
  LecturerProfile: path.join('מבחנים', 'פרופיל המרצה.md'),   // was "מבחנים\\פרופיל המרצה.md"
  ExamPrepPage: 'הכנה למבחן.html',
  CourseJson: '.hit-student-course.json',
  Cs24Folder: 'CS24',
  PointersFolder: 'עם מפנים',

  // Ai.cs
  SkillName: 'sumit-study',
  TimetableFolder: 'מערכת שעות',
  TimetableExt: ['.pdf', '.png', '.jpg', '.jpeg', '.html', '.htm', '.txt'],

  // Council.cs
  ReviewMarker: 'second-opinion',

  // Cs24.cs
  Cs24Base: 'https://cs24.co.il',
  Cs24DefaultRoot: 'https://cs24.co.il/drive?d=e47d12',
  Cs24MaxFiles: 400,

  // Recordings.cs
  TranscriptSuffix: 'תמלול',

  // App.cs - Gemini isn't reliable yet, so it is shown as "coming soon" and everything runs on Claude until it is.
  GeminiEnabled: false,

  SafeToOpen: new Set(['.pdf', '.html', '.htm', '.txt', '.md', '.mp4', '.m4a', '.mp3', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls',
    '.png', '.jpg', '.jpeg', '.gif', '.csv', '.ipynb', '.py', '.c', '.cpp', '.h', '.java', '.m', '.zip', '.url', '.webloc']),
};
