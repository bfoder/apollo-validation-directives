import gql from 'graphql-tag';
import { graphql, GraphQLError, GraphQLResolveInfo } from 'graphql';
import { print } from 'graphql/language/printer';
import { makeExecutableSchema } from 'graphql-tools';

import range from './range';

interface ArgsTestResolverCtx {
  shouldCallResolver: boolean;
  shouldContainValidationErrors?: boolean;
  values?: Record<string, unknown>;
}

describe('validate THROW policy', () => {
  const mockResolver = jest.fn(
    (
      _parent: unknown,
      _args: Record<string, unknown>,
      _ctx: unknown,
      _info: GraphQLResolveInfo & { validationErrors?: unknown[] },
    ): boolean => true,
  );
  beforeEach(() => {
    mockResolver.mockClear();
  });
  const schema = range.addValidationResolversToSchema(
    makeExecutableSchema({
      resolvers: {
        Query: {
          argTest: mockResolver,
          inputTest: mockResolver,
        },
      },
      schemaDirectives: {
        range,
      },
      typeDefs: [
        ...range.getTypeDefs(),
        ...range.getMissingCommonTypeDefs(),
        gql`
          input ThirdInput {
            n: Int @range(max: 200, policy: THROW)
          }
          input SecondInput {
            thirdInput: ThirdInput
            numbersThrow: [Int!] @range(max: 100, policy: THROW)
            numbers: [Int] @range(max: 200)
          }
          input FirstInput {
            n: Int @range(max: 0, policy: THROW)
            secondInput: SecondInput
          }
          type Query {
            argTest(
              n: Int @range(policy: THROW, max: 2)
              n2: Int @range(policy: RESOLVER, max: 10)
            ): Boolean
            inputTest(arg: FirstInput): Boolean
          }
        `,
      ],
    }),
  );
  const doTest = async (
    query: string,
    resolverName: string,
    variables: Record<string, unknown>,
    {
      shouldCallResolver,
      values,
      shouldContainValidationErrors,
    }: ArgsTestResolverCtx,
    expectedErrors?: Error[],
  ): Promise<void> => {
    const { data, errors } = await graphql(
      schema,
      query,
      null,
      null,
      variables,
    );
    expect(mockResolver.mock.calls.length).toBe(shouldCallResolver ? 1 : 0);
    if (shouldCallResolver) {
      const [call] = mockResolver.mock.calls;
      expect(call[1]).toEqual(values);
      if (shouldContainValidationErrors) {
        expect(call[3].validationErrors).toBeTruthy();
      } else {
        expect(call[3].validationErrors).toBeFalsy();
      }
      expect(data).toEqual({ [resolverName]: true });
    }
    if (!expectedErrors) {
      expect(errors).toBeFalsy();
    } else {
      expect(errors).toEqual(expectedErrors);
      expect(data).toEqual({ [resolverName]: null });
    }
  };
  describe('Validate throw in inputs', () => {
    const executeInputTests = doTest.bind(
      null,
      print(gql`
        query InputTest($arg: FirstInput) {
          inputTest(arg: $arg)
        }
      `),
      'inputTest',
    );
    it('Should throw if n on FirstInput is invalid', () =>
      executeInputTests(
        { arg: { n: 2 } },
        {
          shouldCallResolver: false,
        },
        [new GraphQLError('More than 0')],
      ));
    it('Should throw if numbersThrow on SecondInput is invalid', () =>
      executeInputTests(
        { arg: { secondInput: { numbersThrow: [1, 2, 101] } } },
        {
          shouldCallResolver: false,
        },
        [new GraphQLError('More than 100')],
      ));
    it('Should throw if both array inputs on SecondInput are invalid', () =>
      executeInputTests(
        {
          arg: { secondInput: { numbers: [10000], numbersThrow: [1, 2, 101] } },
        },
        {
          shouldCallResolver: false,
        },
        [new GraphQLError('More than 100')],
      ));
    it('Should not throw if numbers on SecondInput is valid', () =>
      executeInputTests(
        { arg: { secondInput: { numbers: [0, 2, 3], numbersThrow: [1, 2] } } },
        {
          shouldCallResolver: true,
          shouldContainValidationErrors: false,
          values: {
            arg: { secondInput: { numbers: [0, 2, 3], numbersThrow: [1, 2] } },
          },
        },
      ));
    it('Should not throw if numbersThrow on SecondInput is null', () =>
      executeInputTests(
        {
          arg: {
            secondInput: { numbers: [0, 2, 3], numbersThrow: null },
          },
        },
        {
          shouldCallResolver: true,
          shouldContainValidationErrors: false,
          values: {
            arg: {
              secondInput: { numbers: [0, 2, 3], numbersThrow: null },
            },
          },
        },
      ));
    it('Should populate validation errors if input is out of range', () =>
      executeInputTests(
        {
          arg: {
            secondInput: {
              numbers: [0, 2, 3, 20000],
              numbersThrow: [1, 2, 100],
              thirdInput: {
                n: 2,
              },
            },
          },
        },
        {
          shouldCallResolver: true,
          shouldContainValidationErrors: true,
          values: {
            arg: {
              secondInput: {
                numbers: null,
                numbersThrow: [1, 2, 100],
                thirdInput: {
                  n: 2,
                },
              },
            },
          },
        },
      ));
    it('Should populate validation errors if input is out of range', () =>
      executeInputTests(
        {
          arg: {
            secondInput: {
              numbers: [0, 2, 3, 20000],
              numbersThrow: [1, 2, 100],
              thirdInput: {
                n: 20000,
              },
            },
          },
        },
        {
          shouldCallResolver: false,
        },
        [new GraphQLError('More than 200')],
      ));
  });
  describe('Validate throw in simple arguments', () => {
    const executeSimpleArgumentsTests = doTest.bind(
      null,
      print(gql`
        query ArgTest($n: Int, $n2: Int) {
          argTest(n: $n, n2: $n2)
        }
      `),
      'argTest',
    );
    it('Should if validation is ok', () =>
      executeSimpleArgumentsTests(
        { n: 0, n2: 1 },
        {
          shouldCallResolver: true,
          shouldContainValidationErrors: false,
          values: { n: 0, n2: 1 },
        },
      ));
    it('Should throw and not call resolver', () =>
      executeSimpleArgumentsTests(
        { n: 200, n2: 1 },
        {
          shouldCallResolver: false,
        },
        [new GraphQLError('More than 2')],
      ));
    it('Should call resolver and not throw', () =>
      executeSimpleArgumentsTests(
        { n: 0, n2: 400 },
        {
          shouldCallResolver: true,
          shouldContainValidationErrors: true,
          values: { n: 0, n2: null },
        },
      ));
    it('Should throw if both validations fail', () =>
      executeSimpleArgumentsTests(
        { n: 200, n2: 400 },
        {
          shouldCallResolver: false,
        },
        [new GraphQLError('More than 2')],
      ));
  });
});
