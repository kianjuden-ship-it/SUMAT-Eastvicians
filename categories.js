// Category set matches Step 2 of the redesigned reporting form. Priorities are assigned
// here (server-side) rather than trusted from the client.
const CATEGORIES = {
  bullying: { label: 'Bullying', priority: 'High' },
  harassment: { label: 'Harassment', priority: 'High' },
  safety: { label: 'Safety Concern', priority: 'High' },
  'mental-health': { label: 'Mental Health Concern', priority: 'High' },
  discrimination: { label: 'Discrimination', priority: 'High' },
  'student-conflict': { label: 'Student Conflict', priority: 'Medium' },
  'teacher-staff': { label: 'Teacher/Staff Concern', priority: 'Medium' },
  other: { label: 'Other', priority: 'Medium' }
};

// Categories that route to the Counselor when the Child Protection Officer decides
// counseling support is needed (used for UI hints; assignment itself is a CPO action).
const COUNSELOR_RELEVANT_CATEGORIES = ['bullying', 'harassment', 'mental-health', 'student-conflict'];

module.exports = { CATEGORIES, COUNSELOR_RELEVANT_CATEGORIES };
