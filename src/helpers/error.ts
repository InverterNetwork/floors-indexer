import { eventLog, handlerContext } from 'generated'

export const handlerErrorWrapper =
  <T>(
    handler: ({ event, context }: { event: eventLog<T>; context: handlerContext }) => Promise<any>,
    options?: {
      onError?: ({
        error,
        event,
        context,
      }: {
        error: unknown
        event: eventLog<T>
        context: handlerContext
      }) => void | Promise<void>
      onFinally?: ({
        event,
        context,
      }: {
        event: eventLog<T>
        context: handlerContext
      }) => void | Promise<void>
    }
  ) =>
  async ({ event, context }: { event: eventLog<T>; context: handlerContext }) => {
    try {
      return await handler({ event, context })
    } catch (error) {
      context.log.error(
        `Error in handler: ${error instanceof Error ? error.message : String(error)}`,
        { event, error }
      )

      if (options?.onError) {
        try {
          await options.onError({ error, event, context })
        } catch (onErrorError) {
          context.log.error(
            `Error in onError callback: ${onErrorError instanceof Error ? onErrorError.message : String(onErrorError)}`,
            { onErrorError }
          )
        }
      }

      return
    } finally {
      if (options?.onFinally) {
        try {
          await options.onFinally({ event, context })
        } catch (onFinallyError) {
          context.log.error(
            `Error in onFinally callback: ${onFinallyError instanceof Error ? onFinallyError.message : String(onFinallyError)}`,
            { onFinallyError }
          )
        }
      }
    }
  }
