import { body, param, query } from 'express-validator'

const objectId = (field, location = body) =>
  location(field).isMongoId().withMessage('Select a valid option.')

const optionalObjectId = (field) =>
  body(field).optional({ nullable: true, checkFalsy: true }).isMongoId().withMessage('Select a valid option.')

export const idParam = [param('id').isMongoId().withMessage('That identifier is not valid.')]

// Password policy: 10+ characters with an uppercase letter, a lowercase letter and a number
const strongPassword = (field, { optional = false } = {}) => {
  const chain = optional ? body(field).optional({ checkFalsy: true }) : body(field)
  return chain
    .isLength({ min: 10, max: 128 })
    .withMessage('Use at least 10 characters.')
    .matches(/[a-z]/)
    .withMessage('Include a lowercase letter.')
    .matches(/[A-Z]/)
    .withMessage('Include an uppercase letter.')
    .matches(/\d/)
    .withMessage('Include a number.')
}
const emailField = (field = 'email') =>
  body(field).trim().notEmpty().withMessage('Email is required.').isEmail().withMessage('Enter a valid email address.').normalizeEmail()

// Auth
export const loginRules = [
  emailField(),
  body('password').isString().notEmpty().withMessage('Password is required.').isLength({ max: 128 }),
  body('role').optional().isIn(['admin', 'teacher', 'student']).withMessage('Unknown sign-in portal.'),
]

export const verifyOtpRules = [
  emailField(),
  body('code')
    .trim()
    .notEmpty()
    .withMessage('Enter the code we emailed you.')
    .matches(/^\d{6}$/)
    .withMessage('Enter the full 6-digit code.'),
  body('remember').optional().isBoolean().toBoolean(),
]

export const resendOtpRules = [emailField()]

export const forgotPasswordRules = [emailField()]

export const resetPasswordRules = [
  body('token').isString().trim().isLength({ min: 20, max: 200 }).withMessage('This reset link is invalid. Request a new one.'),
  strongPassword('password'),
  body('confirmPassword')
    .custom((v, { req }) => v === req.body.password)
    .withMessage('Both passwords must match.'),
]

export const changePasswordRules = [
  body('currentPassword').isString().notEmpty().withMessage('Enter your current password.'),
  strongPassword('newPassword'),
  body('confirmPassword')
    .custom((v, { req }) => v === req.body.newPassword)
    .withMessage('Both passwords must match.'),
]

// Students
export const createStudentRules = [
  body('name').trim().notEmpty().withMessage('Full name is required.').isLength({ max: 120 }),
  body('email').trim().notEmpty().withMessage('Email is required.').isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
  body('roll').trim().notEmpty().withMessage('Roll number is required.'),
  objectId('classRoom'),
  body('guardian.name').trim().notEmpty().withMessage('Guardian name is required.'),
  body('phone').optional({ checkFalsy: true }).isLength({ max: 32 }),
  body('gender').optional().isIn(['Female', 'Male', 'Prefer not to say']).withMessage('Select a valid option.'),
  body('dob').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('Enter a valid date.'),
  body('admissionDate').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('Enter a valid date.'),
  body('status').optional().isIn(['Active', 'Inactive']),
  strongPassword('password', { optional: true }),
]

export const updateStudentRules = [
  ...idParam,
  body('name').optional().trim().notEmpty().withMessage('Full name cannot be empty.'),
  body('email').optional().trim().isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
  optionalObjectId('classRoom'),
  body('status').optional().isIn(['Active', 'Inactive']),
]

export const listQueryRules = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive number.'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100.'),
]

// Teachers
export const createTeacherRules = [
  body('name').trim().notEmpty().withMessage('Full name is required.'),
  body('email').trim().notEmpty().withMessage('Email is required.').isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
  body('qualification').trim().notEmpty().withMessage('Qualification is required.'),
  body('department').isIn(['Sciences', 'Humanities', 'Technology', 'Arts']).withMessage('Select a valid department.'),
  optionalObjectId('subject'),
  body('experience').optional({ checkFalsy: true }).isInt({ min: 0, max: 60 }).withMessage('Enter a number between 0 and 60.'),
  body('classes').optional().isArray().withMessage('Classes must be a list.'),
  body('classes.*').optional().isMongoId().withMessage('One of the selected classes is not valid.'),
  strongPassword('password', { optional: true }),
]

export const auditQueryRules = [
  ...listQueryRules,
  query('status').optional().isIn(['success', 'failure']),
  query('from').optional({ checkFalsy: true }).isISO8601().withMessage('Enter a valid start date.'),
  query('to').optional({ checkFalsy: true }).isISO8601().withMessage('Enter a valid end date.'),
]

export const updateTeacherRules = [
  ...idParam,
  body('email').optional().trim().isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
  body('department').optional().isIn(['Sciences', 'Humanities', 'Technology', 'Arts']),
  body('status').optional().isIn(['Active', 'On Leave', 'Inactive']),
]

// Classes & Subjects
export const classRules = [
  body('name').trim().notEmpty().withMessage('Grade is required.'),
  body('section').trim().notEmpty().withMessage('Section is required.').isLength({ max: 4 }),
  optionalObjectId('classTeacher'),
  body('capacity').optional().isInt({ min: 1, max: 200 }).withMessage('Capacity must be between 1 and 200.'),
]

export const subjectRules = [
  body('code').trim().notEmpty().withMessage('Subject code is required.'),
  body('name').trim().notEmpty().withMessage('Subject name is required.'),
  body('department').isIn(['Sciences', 'Humanities', 'Technology', 'Arts']).withMessage('Select a valid department.'),
  body('credits').optional().isInt({ min: 1, max: 10 }).withMessage('Credits must be between 1 and 10.'),
  optionalObjectId('leadTeacher'),
  body('grades').optional().isArray().withMessage('Grades must be a list.'),
]

// Attendance
export const markAttendanceRules = [
  objectId('classRoom'),
  body('date').optional({ checkFalsy: true }).isISO8601().withMessage('Enter a valid date.'),
  body('period').isInt({ min: 1, max: 12 }).withMessage('Period must be between 1 and 12.'),
  optionalObjectId('subject'),
  body('records').isArray({ min: 1 }).withMessage('The register cannot be empty.'),
  body('records.*.student').isMongoId().withMessage('One of the students is not valid.'),
  body('records.*.status').isIn(['present', 'late', 'absent']).withMessage('Status must be present, late or absent.'),
]

// Exams & Results
export const examRules = [
  body('name').trim().notEmpty().withMessage('Examination name is required.'),
  objectId('classRoom'),
  objectId('subject'),
  body('date').notEmpty().withMessage('Date is required.').isISO8601().withMessage('Enter a valid date.'),
  body('time').optional({ checkFalsy: true }).matches(/^\d{2}:\d{2}$/).withMessage('Use HH:MM.'),
  body('maxMarks').optional().isInt({ min: 1, max: 1000 }).withMessage('Maximum marks must be between 1 and 1000.'),
  body('status').optional().isIn(['Draft', 'Scheduled', 'Grading', 'Results published']),
]

export const saveResultsRules = [
  objectId('exam'),
  body('entries').isArray({ min: 1 }).withMessage('Enter marks for at least one student.'),
  body('entries.*.student').isMongoId().withMessage('One of the students is not valid.'),
  body('entries.*.marks').isFloat({ min: 0 }).withMessage('Marks cannot be negative.'),
]

// Assignments
export const assignmentRules = [
  body('title').trim().notEmpty().withMessage('Title is required.'),
  objectId('subject'),
  objectId('classRoom'),
  body('dueDate').notEmpty().withMessage('Due date is required.').isISO8601().withMessage('Enter a valid date.'),
  body('assignedOn').optional({ checkFalsy: true }).isISO8601().withMessage('Enter a valid date.'),
  body('maxMarks').optional().isInt({ min: 1, max: 1000 }).withMessage('Maximum marks must be between 1 and 1000.'),
  body('submissionType').optional().isIn(['File upload', 'Written (in class)', 'Online quiz']),
]

export const gradeSubmissionRules = [
  ...idParam,
  objectId('student'),
  body('marks').isFloat({ min: 0 }).withMessage('Marks cannot be negative.'),
]

// Fees
export const feeRules = [
  objectId('student'),
  body('term').trim().notEmpty().withMessage('Term is required.'),
  body('amount').isFloat({ min: 0 }).withMessage('Enter a valid amount.'),
  body('dueDate').notEmpty().withMessage('Due date is required.').isISO8601().withMessage('Enter a valid date.'),
  body('description').optional().isIn(['Tuition Fee', 'Laboratory Fee', 'Transport Fee', 'Examination Fee', 'Other']),
  body('status').optional().isIn(['Paid', 'Pending', 'Overdue']),
]

// Timetable
export const timetableRules = [
  param('classRoomId').isMongoId().withMessage('That class identifier is not valid.'),
  body('slots').isArray().withMessage('Slots must be a list.'),
  body('slots.*.day')
    .isIn(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
    .withMessage('Day must be a weekday.'),
  body('slots.*.period').isInt({ min: 1, max: 12 }).withMessage('Period must be between 1 and 12.'),
  body('slots.*.startTime').matches(/^\d{2}:\d{2}$/).withMessage('Use HH:MM.'),
  body('slots.*.endTime').matches(/^\d{2}:\d{2}$/).withMessage('Use HH:MM.'),
]

// Announcements
export const announcementRules = [
  body('title').trim().notEmpty().withMessage('Title is required.').isLength({ max: 160 }),
  body('body').trim().notEmpty().withMessage('Message is required.'),
  body('audience').optional().isIn(['All', 'Students', 'Teachers']).withMessage('Select a valid audience.'),
  body('publishDate').optional({ checkFalsy: true }).isISO8601().withMessage('Enter a valid date.'),
  body('pinned').optional().isBoolean(),
]
