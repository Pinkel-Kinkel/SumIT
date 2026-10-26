'use strict';
// Port of src/NewMaterial.cs

const { Str, Bool, Int, Trunc, delay, dirExists } = require('../util');

const IgnoredMods = ['forum', 'quiz', 'url', 'label'];

function Watched(item) {
  return Str(item, 'url').length > 0 && !IgnoredMods.includes(Str(item, 'mod'));
}

function ItemsOf(section) {
  return section && Array.isArray(section.items) ? section.items.filter(x => x && typeof x === 'object') : [];
}

module.exports = {
  init(host) {
    host.lastNewCheck = 0;
  },
  methods: {
    KnownItems(meta) {
      const list = meta && Array.isArray(meta.knownItems) ? meta.knownItems : null;
      return list ? new Set(list.map(x => String(x))) : new Set();
    },
    RememberItems(course, items) {
      const meta = this.LoadMeta(course);
      const known = this.KnownItems(meta);
      const before = known.size;
      for (const it of items || []) if (Watched(it)) known.add(Str(it, 'url'));
      if (known.size === before && 'knownItems' in meta) return;
      meta.knownItems = Array.from(known);
      this.SaveMeta(course, meta);
    },
    CheckNewMaterial(course, sections, notify) {
      const meta = this.LoadMeta(course);
      if (!Bool(meta, 'setupDone')) return 0;
      const list = Array.isArray(sections) ? sections.filter(x => x && typeof x === 'object') : [];
      if (!('knownItems' in meta)) {
        const allItems = [];
        for (const s of list) for (const it of ItemsOf(s)) allItems.push(it);
        this.RememberItems(course, allItems);
        return 0;
      }
      const known = this.KnownItems(meta);
      const fresh = [];
      for (const s of list) {
        for (const it of ItemsOf(s)) {
          if (Watched(it) && !known.has(Str(it, 'url'))) {
            fresh.push({ num: Int(s, 'num'), title: Str(s, 'title'), name: Str(it, 'name'), mod: Str(it, 'mod') });
          }
        }
      }
      if (fresh.length === 0) return 0;
      this.Send({ type: 'newMaterial', course, items: fresh });
      if (notify) this.Notify('יש חומר חדש ב-Moodle בקורס ' + course + ' (' + fresh.length + ')', course);
      return fresh.length;
    },
    async GetNewMaterial(course, sections, nums) {
      if (!Array.isArray(sections) || !Array.isArray(nums)) return;
      const wanted = new Set(nums.map(x => parseInt(x, 10)).filter(n => !isNaN(n)));
      const list = sections.filter(s => s && wanted.has(Int(s, 'num')));
      for (let i = 0; i < list.length; i++) {
        const at = (i + 0.5) / list.length;
        await this.SyncSectionAsync(course, list[i], (_k, item) => this.Progress(course, 'מוריד את החומר החדש: ' + Trunc(item, 70), at));
      }
      this.Send({ type: 'courseStatus', course, busy: false, text: 'החומר החדש ירד ✓', error: false });
      for (const s of list.filter(s => Int(s, 'num') > 0 && this.CountFiles(this.LectureDir(course, Int(s, 'num'))) > 0)) {
        const r = await this.LecturePdfAsync(course, Int(s, 'num'), Str(s, 'title'));
        if (r && r.Limit) break;
      }
    },
    async BackgroundNewMaterialCheck() {
      if (!this.lastCourses || Date.now() - this.lastNewCheck < 3 * 3600 * 1000) return;
      this.lastNewCheck = Date.now();
      for (const c of Array.from(this.lastCourses)) {
        const name = Str(c, 'name');
        const id = Int(c, 'id');
        if (!Bool(this.LoadMeta(name), 'setupDone')) continue;
        try {
          const v = await this.WithMoodle(() => this.EvalAsync(this.moodle, this.SectionsJs().replace(/COURSE_ID/g, String(id)), 120000));
          const parsed = JSON.parse(v);
          const meta = this.LoadMeta(name);
          meta.sectionsCache = parsed;
          this.SaveMeta(name, meta);
          this.CheckNewMaterial(name, parsed, true);
        } catch { }
        await delay(2000);
      }
    },
  },
};
