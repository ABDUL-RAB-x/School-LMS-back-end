import { Router } from 'express'

import { protect, authorize, withProfile } from '../middleware/auth.js'
import validate from '../middleware/validate.js'
import { loginLimiter, otpLimiter, refreshLimiter, resetLimiter } from '../middleware/rateLimit.js'
import * as V from '../validators/index.js'

import * as auth from '../controllers/auth.controller.js'
import * as students from '../controllers/student.controller.js'
import * as teachers from '../controllers/teacher.controller.js'
import * as academics from '../controllers/academics.controller.js'
import * as attendance from '../controllers/attendance.controller.js'
import * as exams from '../controllers/exam.controller.js'
import * as assignments from '../controllers/assignment.controller.js'
import * as fees from '../controllers/fee.controller.js'
import * as timetable from '../controllers/timetable.controller.js'
import * as announcements from '../controllers/announcement.controller.js'
import * as dashboard from '../controllers/dashboard.controller.js'
import * as settings from '../controllers/settings.controller.js'
import * as auditLogs from '../controllers/auditLog.controller.js'

const router = Router()

const admin = [protect, authorize('admin')]
const teacher = [protect, authorize('teacher'), withProfile]
const student = [protect, authorize('student'), withProfile]
const staff = [protect, authorize('admin', 'teacher'), withProfile]
const anyRole = [protect, withProfile]

// Auth: public entry points
router.post('/auth/login', loginLimiter, validate(V.loginRules), auth.login)
router.post('/auth/verify-otp', otpLimiter, validate(V.verifyOtpRules), auth.verifyOtp)
router.post('/auth/resend-otp', otpLimiter, validate(V.resendOtpRules), auth.resendOtp)
router.post('/auth/refresh', refreshLimiter, auth.refresh)
router.post('/auth/forgot-password', resetLimiter, validate(V.forgotPasswordRules), auth.forgotPassword)
router.post('/auth/reset-password', resetLimiter, validate(V.resetPasswordRules), auth.resetPassword)
router.get('/auth/me', protect, auth.me)
router.post('/auth/logout', protect, auth.logout)
router.post('/auth/logout-all', protect, auth.logoutAll)
router.post('/auth/session-end', auth.endSession)
router.patch('/auth/password', protect, validate(V.changePasswordRules), auth.changePassword)

// Audit log: Admin panel › Audit Log
router.get('/audit-logs', ...admin, validate(V.auditQueryRules), auditLogs.listAuditLogs)

// Dashboards
router.get('/dashboard/admin', ...admin, dashboard.adminDashboard)
router.get('/dashboard/analytics', ...admin, dashboard.adminAnalytics)
router.get('/dashboard/teacher', ...teacher, dashboard.teacherDashboard)
router.get('/dashboard/student', ...student, dashboard.studentDashboard)

// Students: Admin panel › Manage Students
router.get('/students', protect, authorize('admin', 'teacher'), validate(V.listQueryRules), students.listStudents)
router.post('/students', ...admin, validate(V.createStudentRules), students.createStudent)
router.get('/students/:id', protect, authorize('admin', 'teacher'), students.getStudent)
router.put('/students/:id', ...admin, validate(V.updateStudentRules), students.updateStudent)
router.delete('/students/:id', ...admin, validate(V.idParam), students.deleteStudent)

// Teachers: Admin panel › Manage Teachers
router.get('/teachers/me/classes', ...teacher, teachers.myClasses)
router.get('/teachers', protect, authorize('admin'), validate(V.listQueryRules), teachers.listTeachers)
router.post('/teachers', ...admin, validate(V.createTeacherRules), teachers.createTeacher)
router.get('/teachers/:id', ...admin, teachers.getTeacher)
router.put('/teachers/:id', ...admin, validate(V.updateTeacherRules), teachers.updateTeacher)
router.delete('/teachers/:id', ...admin, validate(V.idParam), teachers.deleteTeacher)

// Classes & Sections
router.get('/classes', protect, academics.listClasses)
router.post('/classes', ...admin, validate(V.classRules), academics.createClass)
router.get('/classes/:id', protect, validate(V.idParam), academics.getClass)
router.put('/classes/:id', ...admin, validate([...V.idParam, ...V.classRules]), academics.updateClass)
router.delete('/classes/:id', ...admin, validate(V.idParam), academics.deleteClass)

// Subjects
router.get('/subjects', protect, academics.listSubjects)
router.post('/subjects', ...admin, validate(V.subjectRules), academics.createSubject)
router.put('/subjects/:id', ...admin, validate([...V.idParam, ...V.subjectRules]), academics.updateSubject)
router.delete('/subjects/:id', ...admin, validate(V.idParam), academics.deleteSubject)

// Attendance
router.get('/attendance/me', ...student, attendance.myAttendance)
router.get('/attendance/overview', ...admin, attendance.attendanceOverview)
router.get('/attendance/register', ...staff, attendance.getRegister)
router.post('/attendance', ...staff, validate(V.markAttendanceRules), attendance.markAttendance)

// Exams & Results
router.get('/exams/me', ...student, exams.myExams)
router.get('/exams', ...staff, validate(V.listQueryRules), exams.listExams)
router.post('/exams', ...admin, validate(V.examRules), exams.createExam)
router.put('/exams/:id', ...admin, validate([...V.idParam, ...V.examRules]), exams.updateExam)
router.delete('/exams/:id', ...admin, validate(V.idParam), exams.deleteExam)

router.get('/results/me', ...student, exams.myResults)
router.get('/results/sheet/:examId', ...staff, exams.marksSheet)
router.get('/results', ...staff, validate(V.listQueryRules), exams.listResults)
router.post('/results', ...staff, validate(V.saveResultsRules), exams.saveResults)

// Assignments & Homework
router.get('/assignments/me', ...student, assignments.myAssignments)
router.post('/assignments/:id/submit', ...student, validate(V.idParam), assignments.submitAssignment)
router.get('/assignments', ...staff, validate(V.listQueryRules), assignments.listAssignments)
router.post('/assignments', ...staff, validate(V.assignmentRules), assignments.createAssignment)
router.get('/assignments/:id', ...anyRole, validate(V.idParam), assignments.getAssignment)
router.put('/assignments/:id', ...staff, validate([...V.idParam, ...V.assignmentRules]), assignments.updateAssignment)
router.patch('/assignments/:id/grade', ...staff, validate(V.gradeSubmissionRules), assignments.gradeSubmission)
router.delete('/assignments/:id', ...staff, validate(V.idParam), assignments.deleteAssignment)

// Fees
router.get('/fees/me', ...student, fees.myFees)
router.get('/fees/summary', ...admin, fees.feeSummary)
router.get('/fees', ...admin, validate(V.listQueryRules), fees.listFees)
router.post('/fees', ...admin, validate(V.feeRules), fees.createFee)
router.put('/fees/:id', ...admin, validate(V.idParam), fees.updateFee)
router.post('/fees/:id/remind', ...admin, validate(V.idParam), fees.sendReminder)
router.delete('/fees/:id', ...admin, validate(V.idParam), fees.deleteFee)

// Timetable
router.get('/timetable/me', ...anyRole, timetable.myTimetable)
router.get('/timetable', protect, timetable.getTimetable)
router.put('/timetable/:classRoomId', ...admin, validate(V.timetableRules), timetable.saveTimetable)

// Announcements
router.get('/announcements', protect, validate(V.listQueryRules), announcements.listAnnouncements)
router.post('/announcements', protect, authorize('admin', 'teacher'), validate(V.announcementRules), announcements.createAnnouncement)
router.get('/announcements/:id', protect, validate(V.idParam), announcements.getAnnouncement)
router.put('/announcements/:id', protect, authorize('admin', 'teacher'), validate([...V.idParam, ...V.announcementRules]), announcements.updateAnnouncement)
router.delete('/announcements/:id', protect, authorize('admin', 'teacher'), validate(V.idParam), announcements.deleteAnnouncement)

// Settings
router.get('/settings', protect, settings.getSettings)
router.put('/settings', ...admin, settings.updateSettings)

export default router
