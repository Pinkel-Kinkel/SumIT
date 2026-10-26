'use strict';
// Port of src/Recordings.cs

const fs = require('fs');
const path = require('path');
const { Str, Dict, Int, SafeName, VttToText, FindOnPath, Exec, spawnTracked, deferred, delay, guidN, fileExists, dirExists, mkdirp, writeText } = require('../util');
const platform = require('../platform');
const C = require('../constants');

const ProgressLine = /^\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\S+)(?:.*?at\s+(\S+))?(?:.*?ETA\s+(\S+))?/;

function TranscriptFile(dir, name) {
  return path.join(dir, name + ' ' + C.TranscriptSuffix + '.txt');
}

function FindYtDlp() {
  const own = path.join(platform.ToolsDir, 'bin', 'yt-dlp');
  if (fileExists(own)) return own;
  return FindOnPath('yt-dlp');
}

async function InstallYtDlp() {
  const brew = FindOnPath('brew');
  if (brew) {
    await Exec(brew, ['install', 'yt-dlp'], null, 600000);
    if (FindYtDlp()) return;
  }
  try {
    const dest = path.join(platform.ToolsDir, 'bin', 'yt-dlp');
    mkdirp(path.dirname(dest));
    const resp = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos', { signal: AbortSignal.timeout(300000) });
    if (resp.ok) {
      const buf = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(dest, buf);
      fs.chmodSync(dest, 0o755);
    }
  } catch { }
}

module.exports = {
  init(host) {
    host.jobs = [];
    host.pending = [];
    host.nextJobId = 1;
    host.working = false;
    host.playInfoTcs = null;
    host.zoomCancelled = false;
  },
  methods: {
    TranscriptFile,
    FindYtDlp,

    NewJob(props = {}) {
      return Object.assign({
        Id: 0,
        Url: '',
        Name: '',
        Dir: null,
        Transcript: false,
        State: 'queued',
        Status: 'ממתין...',
        Progress: -1,
        VideoPath: null,
        TranscriptPath: null,
        Course: null,
        Lecture: 0,
        Finished: null,
      }, props);
    },

    AddJob(j) {
      j.Id = this.nextJobId++;
      this.jobs.push(j);
      this.SendJob(j);
      this.pending.push(j);
      this.Pump();
    },

    RetryJob(job) {
      if (!job || job.State !== 'failed') return;
      this.Update(job, 'queued', 'ממתין...', -1);
      this.pending.push(job);
      this.Pump();
    },

    FindJob(m) {
      const id = Int(m, 'id');
      return this.jobs.find(j => j.Id === id) || null;
    },

    SendJob(j) {
      this.Send({
        type: 'job', id: j.Id, name: j.Name, url: j.Url, state: j.State, status: j.Status, progress: j.Progress,
        hasVideo: j.VideoPath !== null, hasTranscript: j.TranscriptPath !== null, course: j.Course, num: j.Lecture,
      });
    },

    Update(j, state, status, progress) {
      j.State = state;
      j.Status = status;
      j.Progress = progress;
      this.SendJob(j);
    },

    Log(j, line) {
      this.Send({ type: 'log', id: j.Id, line });
    },

    async AddRecordingFromPc(course, num, customName) {
      if (num < 1 || num > 200) return;
      const picked = await this.pickFiles('בחר הקלטה (וגם תמלול, אם יש)', [
        { name: 'הקלטה או תמלול', extensions: ['mp4', 'm4a', 'webm', 'mkv', 'txt', 'vtt', 'srt'] },
      ], true);
      if (!picked || picked.length === 0) return;
      const dir = path.join(this.LectureDir(course, num), C.RecordingFolder);
      mkdirp(dir);
      const videoExt = new Set(['.mp4', '.m4a', '.webm', '.mkv']);
      const videos = picked.filter(f => videoExt.has(path.extname(f).toLowerCase()));
      const baseName = SafeName(!customName || !customName.trim() ? 'הרצאה מספר ' + num : customName);
      let last = null;
      let copied = 0;
      for (const f of videos) {
        const name = videos.length === 1 ? baseName : SafeName(path.basename(f, path.extname(f)));
        const ext = path.extname(f).toLowerCase();
        let unique = name;
        for (let i = 2; fileExists(path.join(dir, unique + ext)); i++) unique = name + ' (' + i + ')';
        fs.copyFileSync(f, path.join(dir, unique + ext));
        last = unique;
        copied++;
      }
      for (const f of picked.filter(p => !videoExt.has(path.extname(p).toLowerCase()))) {
        const name = last !== null && videos.length === 1 ? last : SafeName(path.basename(f, path.extname(f)));
        fs.copyFileSync(f, TranscriptFile(dir, name));
        copied++;
      }
      this.SendSectionLocal(course, num);
      this.SendCourseLocal(course);
      this.Toast(copied === 1 ? 'הקובץ נוסף להרצאה ' + num : copied + ' קבצים נוספו להרצאה ' + num, false);
    },

    QueueLectureRecording(course, lecture, url, name = '') {
      this.QueueRecording(course, lecture, url, true, name);
    },

    QueueRecording(course, num, url, manual, customName = '') {
      if (!manual || num < 1 || num > 200 || !dirExists(this.LectureDir(course, num))) return false;
      if (path.extname(customName).toLowerCase() === '.mp4') customName = path.basename(customName, path.extname(customName));
      const meta = this.LoadMeta(course);
      const done = Array.isArray(meta.recordings) ? meta.recordings.map(String) : [];
      const id = url.split('?')[0];
      if ((!manual && done.includes(id)) || this.jobs.some(j => j.Url.split('?')[0] === id && (j.State === 'queued' || j.State === 'running'))) {
        return false;
      }

      const dir = path.join(this.LectureDir(course, num), C.RecordingFolder);
      const already = this.jobs.filter(j => j.Dir === dir).length;
      const baseName = SafeName(!customName || !customName.trim() ? 'הרצאה מספר ' + num + (already > 0 ? ' חלק ' + (already + 1) : '') : customName);
      let name = baseName;
      for (let suffix = 2; fileExists(path.join(dir, name + '.mp4')) || this.jobs.some(j => j.Dir === dir && j.Name === name); suffix++) {
        name = baseName + ' (' + suffix + ')';
      }
      this.AddJob(this.NewJob({
        Url: url, Name: name, Transcript: true, Dir: dir, Course: course, Lecture: num,
        Finished: (j) => {
          if (j.State === 'done') {
            const m2 = this.LoadMeta(course);
            const list = Array.isArray(m2.recordings) ? m2.recordings.slice() : [];
            list.push(id);
            m2.recordings = list;
            this.SaveMeta(course, m2);
          }
          this.SendSectionLocal(course, num);
          this.SendCourseLocal(course);
        },
      }));
      return true;
    },

    OnZoomResponse(url, body) {
      const tcs = this.playInfoTcs;
      if (!tcs || tcs.isCompleted) return;
      if (url.toLowerCase().indexOf('/play/info') < 0) return;
      if (body && body.includes('viewMp4Url')) tcs.resolve(body);
    },

    async Pump() {
      if (this.working) return;
      this.working = true;
      while (this.pending.length > 0) {
        const job = this.pending.shift();
        try { await this.RunJob(job); }
        catch (ex) {
          this.Log(job, 'Error: ' + (ex.message || String(ex)));
          this.Update(job, 'failed', 'משהו השתבש - ראה פרטים', 0);
        }
        if (job.Finished) { try { job.Finished(job); } catch { } }
      }
      this.working = false;
      this.bringToFront('ui');
      if (this.zoom) this.zoom.navigate('about:blank');
    },

    async RunJob(job) {
      if (!this.IsZoomUrl(job.Url)) {
        this.Update(job, 'failed', 'זה לא קישור להקלטת Zoom', 0);
        return;
      }
      this.Update(job, 'running', 'פותח את ההקלטה...', -1);
      this.Log(job, 'Opening ' + job.Url);

      this.playInfoTcs = deferred();
      this.zoomCancelled = false;
      this.zoom.navigate(job.Url);
      const started = Date.now();
      let shown = false;
      while (!this.playInfoTcs.isCompleted) {
        await delay(400);
        if (this.zoomCancelled) {
          this.Update(job, 'failed', 'בוטל - לחץ נסה שוב אחרי ההתחברות', 0);
          return;
        }
        const src = this.zoom.source || '';
        const onRecording = src.toLowerCase().includes('/rec/');
        const elapsedSec = (Date.now() - started) / 1000;
        if (!shown && ((!onRecording && elapsedSec > 2) || elapsedSec > 15)) {
          shown = true;
          this.bringToFront('zoom');
          this.Update(job, 'running', 'מחכה שתתחבר...', -1);
          this.Log(job, 'Zoom needs a sign-in; showing the browser.');
        }
        if (elapsedSec > 600) {
          this.Update(job, 'failed', 'פג הזמן להמתנה ל-Zoom', 0);
          return;
        }
      }
      this.bringToFront('ui');

      const info = JSON.parse(await this.playInfoTcs.promise);
      const result = Dict(info, 'result');
      const mp4Url = Str(result, 'viewMp4Url');
      const transcriptUrl = Str(result, 'transcriptUrl');
      const topic = Str(Dict(result, 'meet'), 'topic');

      const dir = job.Dir || this.RecordingsDir;
      const baseName = SafeName(job.Name.length > 0 ? job.Name : (topic.length > 0 ? topic : 'Zoom recording'));
      mkdirp(dir);
      let name = baseName;
      for (let i = 2; fileExists(path.join(dir, name + '.mp4')) || fileExists(TranscriptFile(dir, name)); i++) {
        name = baseName + ' (' + i + ')';
      }
      job.Name = name;
      this.Log(job, 'Recording: ' + (topic.length > 0 ? topic : '(no title)') + ' -> saving as "' + name + '"');

      if (job.Transcript) {
        if (transcriptUrl.length === 0) {
          this.Log(job, 'This recording has no audio transcript.');
        } else {
          this.Update(job, 'running', 'מוריד תמלול...', -1);
          let vtt = null;
          try {
            const v = await this.EvalAsync(this.zoom, 'const r=await fetch(' + JSON.stringify(transcriptUrl) + ',{credentials:"include"});if(!r.ok) throw new Error("HTTP "+r.status);return await r.text();', 60000);
            vtt = JSON.parse(v);
          } catch (ex) { this.Log(job, 'Transcript: ' + (ex.message || String(ex))); }
          if (vtt && vtt.includes('-->')) {
            job.TranscriptPath = TranscriptFile(dir, name);
            writeText(job.TranscriptPath, VttToText(vtt, name + ' ' + C.TranscriptSuffix));
            this.Log(job, 'Transcript saved: ' + job.TranscriptPath);
          } else {
            this.Log(job, "Couldn't download the transcript.");
          }
        }
      }

      let ytdlp = FindYtDlp();
      if (!ytdlp) {
        this.Update(job, 'running', 'מכין את כלי ההורדה (פעם ראשונה בלבד)...', -1);
        await InstallYtDlp();
        ytdlp = FindYtDlp();
      }
      if (!ytdlp) {
        this.Log(job, 'yt-dlp not found. Install it with: brew install yt-dlp');
        this.Update(job, 'failed', 'כלי ההורדה לא מותקן', 0);
        return;
      }

      const cookieFile = path.join(platform.DataRoot, 'zoom-cookies-' + guidN() + '.txt');
      await this.WriteCookies(cookieFile);
      const agent = this.zoom.userAgent;
      let referer = 'https://zoom.us/';
      try { referer = new URL(this.zoom.source).origin + '/'; } catch { }
      const output = path.join(dir, name.replace(/%/g, '%%') + '.%(ext)s');
      const common = ['--cookies', cookieFile, '--user-agent', agent, '--referer', referer, '--encoding', 'utf-8', '--newline', '--no-mtime', '--no-playlist', '--no-exec', '-o', output];

      this.Update(job, 'running', 'מוריד וידאו...', 0);
      let ok = false;
      try {
        if (mp4Url.startsWith('https://')) ok = await this.RunYtDlp(job, ytdlp, [...common, '--', mp4Url]);
        if (!ok) {
          this.Log(job, 'Trying the Zoom page link instead...');
          ok = await this.RunYtDlp(job, ytdlp, [...common, '--', job.Url]);
        }
      } finally {
        try { if (fileExists(cookieFile)) fs.unlinkSync(cookieFile); } catch { }
      }

      if (ok) {
        try {
          for (const f of fs.readdirSync(dir)) {
            if (!f.startsWith(name + '.')) continue;
            const ext = path.extname(f).toLowerCase();
            if (['.mp4', '.m4a', '.webm', '.mkv'].includes(ext)) job.VideoPath = path.join(dir, f);
          }
        } catch { }
        this.Update(job, 'done', job.TranscriptPath ? 'הוידאו והתמלול נשמרו' : 'הוידאו נשמר', 100);
      } else {
        this.Update(job, 'failed', job.TranscriptPath ? 'התמלול נשמר, הוידאו נכשל' : 'ההורדה נכשלה - ראה פרטים', 0);
      }
    },

    async WriteCookies(file) {
      const cookies = await this.zoom.cookies();
      let sb = '# Netscape HTTP Cookie File\n';
      for (const c of cookies) {
        const dom = (c.domain || '').replace(/^\.+/, '');
        if (!dom.toLowerCase().endsWith('zoom.us')) continue;
        const expires = c.session || !c.expirationDate ? Math.floor(Date.now() / 1000) + 86400 : Math.floor(c.expirationDate);
        sb += [
          c.domain,
          c.domain.startsWith('.') ? 'TRUE' : 'FALSE',
          c.path || '/',
          c.secure ? 'TRUE' : 'FALSE',
          expires,
          c.name,
          c.value,
        ].join('\t') + '\n';
      }
      writeText(file, sb);
    },

    RunYtDlp(job, exe, args) {
      return new Promise((resolve) => {
        let p;
        try {
          p = spawnTracked(exe, args, { env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
        } catch (ex) {
          this.Log(job, "Couldn't start " + path.basename(exe) + ': ' + (ex.message || String(ex)));
          resolve(false);
          return;
        }
        const feedLines = (chunk, isErr) => {
          for (const line of String(chunk).split(/\r?\n/)) {
            if (!line) continue;
            if (isErr) this.Log(job, line);
            else this.HandleLine(job, line);
          }
        };
        p.stdout.on('data', d => feedLines(d, false));
        p.stderr.on('data', d => feedLines(d, true));
        p.on('error', (ex) => { this.Log(job, ex.message || String(ex)); resolve(false); });
        p.on('close', (code) => resolve(code === 0));
      });
    },

    HandleLine(job, line) {
      const m = ProgressLine.exec(line);
      if (m) {
        const pct = parseFloat(m[1]);
        if (!isNaN(pct)) {
          let status = 'מוריד וידאו · ' + m[1] + '% מתוך ' + m[2];
          if (m[4] && !m[4].startsWith('Unknown')) status += ' · נשארו ' + m[4];
          this.Update(job, 'running', status, Math.floor(pct));
          if (pct < 100) return;
        }
      }
      this.Log(job, line);
    },
  },
};
