import { RefType, Repository } from '../api/git';

export const getTagsForHead = async (rawRepository: Repository): Promise<string[]> => {
  const refs = await rawRepository.getRefs({ pattern: 'refs/tags' });

  return refs
    .filter(r => r.type === RefType.Tag && r.commit === rawRepository.state.HEAD?.commit)
    .map(r => r.name ?? '');
};
