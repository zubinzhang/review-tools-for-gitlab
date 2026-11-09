import { fromReviewUri, isEmptyFileUri, toReviewUri } from './review_uri';

describe('review_uri.ts', () => {
  const reviewUriParams = {
    commit: 'abcdef',
    path: '/review',
    exists: true,
    projectId: 1234,
    mrId: 2345,
    repositoryRoot: 'path/to/workspace',
    changeType: 'added' as const,
  };

  describe('toReviewUri', () => {
    it('returns the correct Uri', () => {
      const result = toReviewUri(reviewUriParams);

      expect(result.toString()).toEqual(
        'gitlab-review-diff:///review?{"changeType":"added","commit":"abcdef","exists":"1","mrId":2345,"projectId":1234,"repositoryRoot":"path/to/workspace"}',
      );
    });
  });

  describe('fromReviewUri', () => {
    it('preserves commit comparison scope and keeps it distinct from the whole MR', () => {
      const params = { ...reviewUriParams, comparison: 'commit' as const };
      expect(fromReviewUri(toReviewUri(params))).toEqual(params);
      expect(toReviewUri(params).toString()).not.toBe(toReviewUri(reviewUriParams).toString());
    });
    it('returns the correct string', () => {
      const result = fromReviewUri(toReviewUri(reviewUriParams));

      expect(result).toEqual(reviewUriParams);
    });
  });

  describe('isEmptyFileUri', () => {
    it('returns true for empty file', () => {
      const uri = toReviewUri({ ...reviewUriParams, exists: false });
      expect(isEmptyFileUri(uri)).toBe(true);
    });

    it('returns false for diff file', () => {
      const uri = toReviewUri(reviewUriParams);
      expect(isEmptyFileUri(uri)).toBe(false);
    });
  });
});
