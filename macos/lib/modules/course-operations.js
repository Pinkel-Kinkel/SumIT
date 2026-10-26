'use strict';
// Port of src/CourseOperations.cs

module.exports = {
  init(host) {
    host.courseOperations = new Set();
  },
  methods: {
    async RunCourseOperation(course, operation, work) {
      const key = operation + '|' + course;
      if (this.courseOperations.has(key)) return;
      this.courseOperations.add(key);
      this.Send({ type: 'operationStatus', course, operation, busy: true });
      try {
        await work();
      } catch (ex) {
        this.Send({ type: 'courseStatus', course, busy: false, error: true, text: ex && ex.message ? ex.message : String(ex) });
      } finally {
        this.courseOperations.delete(key);
        this.Send({ type: 'operationStatus', course, operation, busy: false });
      }
    },
  },
};
