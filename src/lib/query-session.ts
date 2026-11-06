import { createContext } from 'react';

export type QuerySession = { id: number; now: Date };
export const QuerySessionContext = createContext<QuerySession>({ id: 0, now: new Date() });
