/** A cancelled request must never resume startup or change a newer take. */
export class CancelledStart extends Error {}

export class StartAttempts {
  private current = 0;

  cancel() { this.current++; }

  begin() {
    const id = ++this.current;
    const isCurrent = () => this.current === id;
    return {
      isCurrent,
      async wait<T>(operation: Promise<T>): Promise<T> {
        try {
          const result = await operation;
          if (!isCurrent()) throw new CancelledStart();
          return result;
        } catch (error) {
          if (!isCurrent()) throw new CancelledStart();
          throw error;
        }
      },
    };
  }
}

export type StartAttempt = ReturnType<StartAttempts['begin']>;
