import { ensureAbsoluteAvatarUrl } from './ensure_absolute_avatar_url';

describe('ensureAbsoluteAvatarUrl', () => {
  const instanceUrl = 'https://gitlab.example.com';
  it('resolves relative URLs against instance URL', () => {
    const avatarUrl = '/uploads/-/system/user/avatar/123/avatar.png?width=80';

    expect(ensureAbsoluteAvatarUrl(instanceUrl, avatarUrl)).toBe(
      'https://gitlab.example.com/uploads/-/system/user/avatar/123/avatar.png?width=80',
    );
  });

  it('leaves absolute URLs unchanged', () => {
    const avatarUrl = 'https://cdn.example.com/avatar.png';

    expect(ensureAbsoluteAvatarUrl(instanceUrl, avatarUrl)).toBe(avatarUrl);
  });
});
