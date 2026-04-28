import { describe, expect, it } from 'vitest';
import {
  buildFeedbackHeadline,
  buildFeedbackQuote,
  getAdminGuestDisplayName,
  getOrderClockLabel,
} from '../feedbackPresentation';

describe('feedback presentation', () => {
  it('keeps the real summary when written feedback metadata exists', () => {
    expect(buildFeedbackHeadline({
      feedbackSummary: '4★ · Food 4 · Staff 5',
      rating: 4,
      managerFollowUpRequested: false,
    })).toBe('4★ · Food 4 · Staff 5');
  });

  it('uses neutral operational copy instead of fabricated review prose', () => {
    expect(buildFeedbackHeadline({
      feedbackSummary: '',
      rating: 5,
      managerFollowUpRequested: false,
    })).toBe('5-star service review');

    expect(buildFeedbackQuote({
      feedbackText: '',
      feedbackSummary: '',
    })).toBe('No written comment submitted.');
  });

  it('elevates manager follow-up requests without inventing a guest story', () => {
    expect(buildFeedbackHeadline({
      feedbackSummary: '',
      rating: 2,
      managerFollowUpRequested: true,
    })).toBe('Manager follow-up requested');
  });

  it('replaces generic placeholder guest labels and missing timestamps with operational copy', () => {
    expect(getAdminGuestDisplayName('')).toBe('Room guest');
    expect(getOrderClockLabel(null)).toBe('Awaiting sync');
  });
});
