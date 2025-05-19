import type { BaseJob, RunningJobFromTask } from './config/types/workflowTypes.js'

import {
  createLocalReq,
  type Payload,
  type PayloadRequest,
  type RunningJob,
  type Sort,
  type TypedJobs,
  type Where,
} from '../index.js'
import { jobAfterRead, jobsCollectionSlug } from './config/index.js'
import { runJobs } from './operations/runJobs/index.js'
import { updateJob, updateJobs } from './utilities/updateJob.js'

export const getJobsLocalAPI = (payload: Payload) => ({
  queue: async <
    // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents
    TTaskOrWorkflowSlug extends keyof TypedJobs['tasks'] | keyof TypedJobs['workflows'],
  >(
    args:
      | {
          input: TypedJobs['tasks'][TTaskOrWorkflowSlug]['input']
          queue?: string
          req?: PayloadRequest
          // TTaskOrWorkflowlug with keyof TypedJobs['workflows'] removed:
          task: TTaskOrWorkflowSlug extends keyof TypedJobs['tasks'] ? TTaskOrWorkflowSlug : never
          waitUntil?: Date
          workflow?: never
        }
      | {
          input: TypedJobs['workflows'][TTaskOrWorkflowSlug]['input']
          queue?: string
          req?: PayloadRequest
          task?: never
          waitUntil?: Date
          workflow: TTaskOrWorkflowSlug extends keyof TypedJobs['workflows']
            ? TTaskOrWorkflowSlug
            : never
        },
  ): Promise<
    TTaskOrWorkflowSlug extends keyof TypedJobs['workflows']
      ? RunningJob<TTaskOrWorkflowSlug>
      : RunningJobFromTask<TTaskOrWorkflowSlug>
  > => {
    let queue: string | undefined = undefined

    // If user specifies queue, use that
    if (args.queue) {
      queue = args.queue
    } else if (args.workflow) {
      // Otherwise, if there is a workflow specified, and it has a default queue to use,
      // use that
      const workflow = payload.config.jobs?.workflows?.find(({ slug }) => slug === args.workflow)
      if (workflow?.queue) {
        queue = workflow.queue
      }
    }

    const data: Partial<BaseJob> = {
      input: args.input,
    }

    if (queue) {
      data.queue = queue
    }
    if (args.waitUntil) {
      data.waitUntil = args.waitUntil?.toISOString()
    }
    if (args.workflow) {
      data.workflowSlug = args.workflow as string
    }
    if (args.task) {
      data.taskSlug = args.task as string
    }

    type ReturnType = TTaskOrWorkflowSlug extends keyof TypedJobs['workflows']
      ? RunningJob<TTaskOrWorkflowSlug>
      : RunningJobFromTask<TTaskOrWorkflowSlug> // Type assertion is still needed here

    if (payload?.config?.jobs?.depth || payload?.config?.jobs?.runHooks) {
      return (await payload.create({
        collection: jobsCollectionSlug,
        data,
        depth: payload.config.jobs.depth ?? 0,
        req: args.req,
      })) as ReturnType
    } else {
      return jobAfterRead({
        config: payload.config,
        doc: await payload.db.create({
          collection: jobsCollectionSlug,
          data,
          req: args.req,
        }),
      }) as unknown as ReturnType
    }
  },

  run: async (args?: {
    limit?: number
    overrideAccess?: boolean
    /**
     * Adjust the job processing order using a Payload sort string.
     *
     * FIFO would equal `createdAt` and LIFO would equal `-createdAt`.
     */
    processingOrder?: Sort
    queue?: string
    req?: PayloadRequest
    /**
     * By default, jobs are run in parallel.
     * If you want to run them in sequence, set this to true.
     */
    sequential?: boolean
    where?: Where
  }): Promise<ReturnType<typeof runJobs>> => {
    const newReq: PayloadRequest = args?.req ?? (await createLocalReq({}, payload))

    return await runJobs({
      limit: args?.limit,
      overrideAccess: args?.overrideAccess !== false,
      processingOrder: args?.processingOrder,
      queue: args?.queue,
      req: newReq,
      sequential: args?.sequential,
      where: args?.where,
    })
  },

  runByID: async <T extends Record<string, any> = Record<string, any>>(args: {
    id: number | string
    overrideAccess?: boolean
    req?: PayloadRequest
    returnTaskOutput?: boolean
  }): Promise<{ taskOutput?: T } & ReturnType<typeof runJobs>> => {
    const newReq: PayloadRequest = args.req ?? (await createLocalReq({}, payload))

    const result = await runJobs({
      id: args.id,
      overrideAccess: args.overrideAccess !== false,
      req: newReq,
    })

    if (args.returnTaskOutput) {
      const job = await payload.findByID({
        id: args.id,
        collection: jobsCollectionSlug,
        depth: 0,
        req: newReq,
      })

      const taskOutput = {} as T
      if (job?.log?.length) {
        job.log.forEach((logEntry) => {
          if (logEntry.state === 'succeeded' && logEntry.taskSlug && logEntry.output) {
            taskOutput[logEntry.taskSlug as keyof T] = logEntry.output
          }
        })
      }

      return Object.assign({}, result, { taskOutput })
    }

    return result
  },

  cancel: async (args: {
    overrideAccess?: boolean
    queue?: string
    req?: PayloadRequest
    where: Where
  }): Promise<void> => {
    const newReq: PayloadRequest = args.req ?? (await createLocalReq({}, payload))

    const and: Where[] = [
      args.where,
      {
        completedAt: {
          exists: false,
        },
      },
      {
        hasError: {
          not_equals: true,
        },
      },
    ]

    if (args.queue) {
      and.push({
        queue: {
          equals: args.queue,
        },
      })
    }

    await updateJobs({
      data: {
        completedAt: null,
        error: {
          cancelled: true,
        },
        hasError: true,
        processing: false,
        waitUntil: null,
      } as {
        completedAt: null
        waitUntil: null
      } & BaseJob,
      depth: 0, // No depth, since we're not returning
      disableTransaction: true,
      req: newReq,
      returning: false,
      where: { and },
    })
  },

  cancelByID: async (args: {
    id: number | string
    overrideAccess?: boolean
    req?: PayloadRequest
  }): Promise<void> => {
    const newReq: PayloadRequest = args.req ?? (await createLocalReq({}, payload))

    await updateJob({
      id: args.id,
      data: {
        completedAt: null,
        error: {
          cancelled: true,
        },
        hasError: true,
        processing: false,
        waitUntil: null,
      } as {
        completedAt: null
        waitUntil: null
      } & BaseJob,
      depth: 0, // No depth, since we're not returning
      disableTransaction: true,
      req: newReq,
      returning: false,
    })
  },

  queueAndRun: async <
    // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents
    TTaskOrWorkflowSlug extends keyof TypedJobs['tasks'] | keyof TypedJobs['workflows'],
  >(
    args:
      | {
          input: TypedJobs['tasks'][TTaskOrWorkflowSlug]['input']
          queue?: string
          req?: PayloadRequest
          // TTaskOrWorkflowlug with keyof TypedJobs['workflows'] removed:
          task: TTaskOrWorkflowSlug extends keyof TypedJobs['tasks'] ? TTaskOrWorkflowSlug : never
          waitUntil?: Date
          workflow?: never
        }
      | {
          input: TypedJobs['workflows'][TTaskOrWorkflowSlug]['input']
          queue?: string
          req?: PayloadRequest
          task?: never
          waitUntil?: Date
          workflow: TTaskOrWorkflowSlug extends keyof TypedJobs['workflows']
            ? TTaskOrWorkflowSlug
            : never
        },
  ): Promise<{
    job: TTaskOrWorkflowSlug extends keyof TypedJobs['workflows']
      ? RunningJob<TTaskOrWorkflowSlug>
      : RunningJobFromTask<TTaskOrWorkflowSlug>
    result: {
      jobStatus?: Record<string, { status: 'error' | 'error-reached-max-retries' | 'success' }>
      noJobsRemaining?: boolean
      remainingJobsFromQueried: number
      taskOutput?: Record<string, any>
    }
  }> => {
    const job = await payload.jobs.queue(args)

    const newReq: PayloadRequest = args.req ?? (await createLocalReq({}, payload))
    const result = await payload.jobs.runByID({
      id: job.id,
      overrideAccess: true,
      req: newReq,
      returnTaskOutput: true,
    })

    return {
      job,
      result,
    }
  },
})
