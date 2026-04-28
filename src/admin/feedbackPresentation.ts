export function getAdminGuestDisplayName(lastName: string): string {
  return lastName.trim() || 'Room guest';
}

export function getOrderClockLabel(createdAt: Date | null): string {
  if (!createdAt) return 'Awaiting sync';
  return createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function buildFeedbackHeadline(input: {
  feedbackSummary: string;
  rating: number | null;
  managerFollowUpRequested: boolean;
}): string {
  if (input.feedbackSummary.trim()) return input.feedbackSummary.trim();
  if (input.managerFollowUpRequested) return 'Manager follow-up requested';
  if (typeof input.rating === 'number') return `${input.rating}-star service review`;
  return 'Guest service review';
}

export function buildFeedbackQuote(input: {
  feedbackText: string;
  feedbackSummary: string;
}): string {
  if (input.feedbackText.trim()) return input.feedbackText.trim();
  if (input.feedbackSummary.trim()) return 'No written comment submitted.';
  return 'No written comment submitted.';
}
