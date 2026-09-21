import type { Bootstrap, Task } from './types';

export function appendUniqueTasks(current: Task[], incoming: Task[]): Task[] {
  const result = new Map(current.map(task => [task.id, task]));
  incoming.forEach(task => result.set(task.id, task));
  return [...result.values()];
}

/** Retain explicitly loaded older pages when the 30-second refresh arrives. */
export function preserveExpandedHistory(current: Bootstrap | null, fresh: Bootstrap): Bootstrap {
  if (!current || current.user.id !== fresh.user.id) return fresh;
  const older = current.tasks.filter(task => task.status === 'COMPLETED' || task.status === 'CANCELLED');
  return { ...fresh, tasks: appendUniqueTasks(older, fresh.tasks), taskHistoryPage: current.taskHistoryPage };
}
