/* The DeepPartial type definition is copied from the MIT-licensed utility-types project
   https://github.com/piotrwitek/utility-types/blob/411e83ecf70e428b529fc2a09a49519e8f36c8fa/src/mapped-types.ts#L504 */

type _DeepPartialArray<T> = Array<_DeepPartial<T>>;

// ban-types lint rule disabled so we can use Function from the copied utility-types implementation
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type _DeepPartial<T> = T extends Function
  ? T
  : T extends Array<infer U>
    ? _DeepPartialArray<U>
    : T extends object
      ? DeepPartial<T>
      : T | undefined;

type DeepPartial<T> = { [P in keyof T]?: _DeepPartial<T[P]> };

export const createFakePartial = <T>(x: DeepPartial<T>): T => x as T;
