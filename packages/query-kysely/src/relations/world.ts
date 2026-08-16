import { sql, type Kysely } from "kysely";
import type { ReadonlyQueryCreator } from "kysely/readonly";
import type { PhysicalOpenCodeV2 } from "../source/contracts.ts";
import type {
  AssistantMessageRelation,
  AttachmentRelation,
  CompactionRelation,
  ContentRelation,
  CotailRelations,
  ShellExecutionRelation,
  ToolCallRelation,
  ToolResultRelation,
  UserMessageRelation,
} from "./schema.ts";

export function logicalWorld(
  physical: Kysely<PhysicalOpenCodeV2>,
): ReadonlyQueryCreator<CotailRelations> {
  const seeded = physical
    .with("cotail_session", (db) => db.selectFrom("session_v2").select([
      "id as sessionID", "project_id as projectID", "workspace_id as workspaceID",
      "parent_id as parentID", "fork_session_id as forkSessionID", "fork_boundary as forkBoundary",
      "slug", "directory", "path", "title", "version", "share_url as shareURL",
      "summary_additions as summaryAdditions", "summary_deletions as summaryDeletions",
      "summary_files as summaryFiles", "summary_diffs as summaryDiffsJSON", "metadata as metadataJSON",
      "cost", "tokens_input as tokensInput", "tokens_output as tokensOutput",
      "tokens_reasoning as tokensReasoning", "tokens_cache_read as tokensCacheRead",
      "tokens_cache_write as tokensCacheWrite", "revert as revertJSON", "permission as permissionJSON",
      "agent", "model", "time_created as createdAt", "time_updated as updatedAt",
      "time_compacting as compactingAt", "time_archived as archivedAt", "time_suspended as suspendedAt",
    ]))
    .with("cotail_message", (db) => db.selectFrom("session_message").select([
      "session_id as sessionID", "id as messageID", "type as messageType", "seq as messageSeq",
      "time_created as createdAt", "time_updated as updatedAt", "data as sourceJSON",
    ]))
    .with("cotail_user_message", () => sql<UserMessageRelation>`(
      select session_id as sessionID, id as messageID, seq as messageSeq,
             json_extract(data, '$.text') as text,
             data -> '$.files' as filesJSON, data -> '$.agents' as agentsJSON,
             data -> '$.skills' as skillsJSON, data -> '$.metadata' as metadataJSON
      from session_message
      where type = 'user' and json_valid(data)
        and json_type(data, '$.text') = 'text'
        and coalesce(json_type(data, '$.files'), 'array') = 'array'
        and coalesce(json_type(data, '$.agents'), 'array') = 'array'
        and coalesce(json_type(data, '$.skills'), 'array') = 'array'
        and coalesce(json_type(data, '$.metadata'), 'object') = 'object'
    )`)
    .with("cotail_assistant_message", () => sql<AssistantMessageRelation>`(
      select session_id as sessionID, id as messageID, seq as messageSeq,
             json_extract(data, '$.agent') as agent,
             json_extract(data, '$.model.id') as modelID,
             json_extract(data, '$.model.providerID') as providerID,
             json_extract(data, '$.model.variant') as modelVariant,
             json_extract(data, '$.finish') as finish,
             json_extract(data, '$.cost') as cost,
             json_extract(data, '$.tokens.input') as tokensInput,
             json_extract(data, '$.tokens.output') as tokensOutput,
             json_extract(data, '$.tokens.reasoning') as tokensReasoning,
             json_extract(data, '$.tokens.cache.read') as tokensCacheRead,
             json_extract(data, '$.tokens.cache.write') as tokensCacheWrite,
             json_extract(data, '$.error.type') as errorType,
             json_extract(data, '$.error.message') as errorMessage,
             json_extract(data, '$.error.status') as errorStatus,
             json_extract(data, '$.retry.attempt') as retryAttempt,
             json_extract(data, '$.retry.at') as retryAt,
             data -> '$.retry.error' as retryErrorJSON,
             json_extract(data, '$.snapshot.start') as snapshotStart,
             json_extract(data, '$.snapshot.end') as snapshotEnd,
             data -> '$.snapshot.files' as snapshotFilesJSON,
             data -> '$.metadata' as metadataJSON,
             time_created as createdAt,
             json_extract(data, '$.time.completed') as completedAt
      from session_message
      where type = 'assistant' and json_valid(data)
        and json_type(data, '$.agent') = 'text'
        and json_type(data, '$.model') = 'object'
        and json_type(data, '$.model.id') = 'text'
        and json_type(data, '$.model.providerID') = 'text'
        and json_type(data, '$.content') = 'array'
        and coalesce(json_type(data, '$.metadata'), 'object') = 'object'
    )`)
    .with("cotail_content", () => sql<ContentRelation>`(
      select session_id as sessionID, id as messageID, seq as messageSeq, 0 as contentIndex,
             type as contentKind, json_extract(data, '$.text') as text,
             json_extract(data, '$.description') as description,
             json_extract(data, '$.skill') as skillID, json_extract(data, '$.name') as skillName,
             null as providerStateJSON, null as createdAt, null as completedAt
      from session_message
      where type in ('user', 'synthetic', 'system', 'skill') and json_valid(data)
        and json_type(data, '$.text') = 'text'
        and (type != 'skill' or (json_type(data, '$.skill') = 'text' and json_type(data, '$.name') = 'text'))
      union all
      select sm.session_id, sm.id, sm.seq, cast(item.key as integer),
             json_extract(item.value, '$.type'), json_extract(item.value, '$.text'),
             null, null, null, item.value -> '$.state',
             json_extract(item.value, '$.time.created'), json_extract(item.value, '$.time.completed')
      from session_message sm, json_each(case when json_valid(sm.data) then sm.data else '{}' end, '$.content') item
      where sm.type = 'assistant' and json_type(sm.data, '$.content') = 'array'
        and json_extract(item.value, '$.type') in ('text', 'reasoning')
        and json_type(item.value, '$.text') = 'text'
        and coalesce(json_type(item.value, '$.state'), 'object') = 'object'
    )`)
    .with("cotail_tool_call", () => sql<ToolCallRelation>`(
      select sm.session_id as sessionID, sm.id as messageID, sm.seq as messageSeq,
             cast(item.key as integer) as contentIndex,
             json_extract(item.value, '$.id') as callID,
             json_extract(item.value, '$.name') as toolName,
             json_extract(item.value, '$.state.status') as state,
             item.value -> '$.state.input' as inputJSON,
             json_extract(item.value, '$.executed') as executed,
             item.value -> '$.state.metadata' as metadataJSON,
             item.value -> '$.providerState' as providerStateJSON,
             item.value -> '$.providerResultState' as providerResultStateJSON,
             json_extract(item.value, '$.state.error.type') as errorType,
             json_extract(item.value, '$.state.error.message') as errorMessage,
             json_extract(item.value, '$.state.error.status') as errorStatus,
             json_extract(item.value, '$.time.created') as createdAt,
             json_extract(item.value, '$.time.ran') as ranAt,
             json_extract(item.value, '$.time.completed') as completedAt
      from session_message sm, json_each(case when json_valid(sm.data) then sm.data else '{}' end, '$.content') item
      where sm.type = 'assistant' and json_type(sm.data, '$.content') = 'array'
        and json_extract(item.value, '$.type') = 'tool'
        and json_type(item.value, '$.id') = 'text' and json_type(item.value, '$.name') = 'text'
        and json_extract(item.value, '$.state.status') in ('streaming', 'running', 'completed', 'error')
        and ((json_extract(item.value, '$.state.status') = 'streaming' and json_type(item.value, '$.state.input') = 'text')
          or (json_extract(item.value, '$.state.status') != 'streaming' and json_type(item.value, '$.state.input') = 'object'))
        and (json_extract(item.value, '$.state.status') != 'running'
          or json_type(item.value, '$.state.metadata') = 'object')
        and (json_extract(item.value, '$.state.status') != 'completed'
          or (json_type(item.value, '$.state.content') = 'array'
            and json_array_length(item.value, '$.state.content') > 0))
        and (json_extract(item.value, '$.state.status') != 'error'
          or (json_type(item.value, '$.state.error') = 'object'
            and json_type(item.value, '$.state.error.type') = 'text'
            and json_type(item.value, '$.state.error.message') = 'text'))
        and coalesce(json_type(item.value, '$.state.metadata'), 'object') = 'object'
        and coalesce(json_type(item.value, '$.providerState'), 'object') = 'object'
        and coalesce(json_type(item.value, '$.providerResultState'), 'object') = 'object'
        and coalesce(json_type(item.value, '$.executed'), 'true') in ('true', 'false')
        and json_type(item.value, '$.time.created') in ('integer', 'real')
    )`)
    .with("cotail_tool_result", () => sql<ToolResultRelation>`(
      select sm.session_id as sessionID, sm.id as messageID, sm.seq as messageSeq,
             cast(item.key as integer) as contentIndex,
             json_extract(item.value, '$.id') as callID, cast(result.key as integer) as resultIndex,
             json_extract(result.value, '$.type') as resultKind,
             json_extract(result.value, '$.text') as text,
             json_extract(result.value, '$.uri') as uri,
             json_extract(result.value, '$.mime') as mime,
             json_extract(result.value, '$.name') as name
      from session_message sm,
           json_each(case when json_valid(sm.data) then sm.data else '{}' end, '$.content') item,
           json_each(case when json_type(item.value, '$.state.content') = 'array' then item.value else '{}' end, '$.state.content') result
      where sm.type = 'assistant' and json_extract(item.value, '$.type') = 'tool'
        and json_extract(item.value, '$.state.status') in ('completed', 'error')
        and ((json_extract(result.value, '$.type') = 'text' and json_type(result.value, '$.text') = 'text')
          or (json_extract(result.value, '$.type') = 'file'
            and json_type(result.value, '$.uri') = 'text' and json_type(result.value, '$.mime') = 'text'
            and coalesce(json_type(result.value, '$.name'), 'text') = 'text'))
    )`)
    .with("cotail_shell_execution", () => sql<ShellExecutionRelation>`(
      select session_id as sessionID, id as messageID, seq as messageSeq,
             json_extract(data, '$.shellID') as shellID, json_extract(data, '$.command') as command,
             json_extract(data, '$.status') as status, json_extract(data, '$.exit') as exit,
             json_extract(data, '$.output.output') as output,
             json_extract(data, '$.output.cursor') as outputCursor,
             json_extract(data, '$.output.size') as outputSize,
             json_extract(data, '$.output.truncated') as outputTruncated,
             data -> '$.metadata' as metadataJSON,
             json_extract(data, '$.time.created') as createdAt,
             json_extract(data, '$.time.completed') as completedAt
      from session_message
      where type = 'shell' and json_valid(data)
        and json_type(data, '$.shellID') = 'text' and json_type(data, '$.command') = 'text'
        and json_extract(data, '$.status') in ('running', 'exited', 'timeout', 'killed')
        and json_type(data, '$.time.created') in ('integer', 'real')
        and (json_type(data, '$.output') is null or (json_type(data, '$.output') = 'object'
          and json_type(data, '$.output.output') = 'text'
          and json_type(data, '$.output.cursor') = 'integer'
          and json_type(data, '$.output.size') = 'integer'
          and json_type(data, '$.output.truncated') in ('true', 'false')))
    )`)
    .with("cotail_attachment", () => sql<AttachmentRelation>`(
      select sm.session_id as sessionID, sm.id as messageID, sm.seq as messageSeq,
             cast(file.key as integer) as attachmentIndex, cast(file.key as integer) as sourceIndex,
             'file' as attachmentType, json_extract(file.value, '$.mime') as mime,
             json_extract(file.value, '$.source.type') as sourceType,
             json_extract(file.value, '$.source.uri') as uri, json_extract(file.value, '$.name') as name,
             json_extract(file.value, '$.description') as description, null as skillID, null as text,
             json_extract(file.value, '$.mention.start') as mentionStart,
             json_extract(file.value, '$.mention.end') as mentionEnd,
             json_extract(file.value, '$.mention.text') as mentionText
      from session_message sm, json_each(case when json_valid(sm.data) then sm.data else '{}' end, '$.files') file
      where sm.type = 'user' and json_type(sm.data, '$.files') = 'array'
        and json_type(file.value, '$.data') = 'text' and json_type(file.value, '$.mime') = 'text'
        and json_extract(file.value, '$.source.type') in ('inline', 'uri')
        and (json_extract(file.value, '$.source.type') != 'uri' or json_type(file.value, '$.source.uri') = 'text')
      union all
      select sm.session_id, sm.id, sm.seq,
             coalesce(json_array_length(sm.data, '$.files'), 0) + cast(agent.key as integer), cast(agent.key as integer),
             'agent', null, null, null, json_extract(agent.value, '$.name'), null, null, null,
             json_extract(agent.value, '$.mention.start'), json_extract(agent.value, '$.mention.end'),
             json_extract(agent.value, '$.mention.text')
      from session_message sm, json_each(case when json_valid(sm.data) then sm.data else '{}' end, '$.agents') agent
      where sm.type = 'user' and json_type(sm.data, '$.agents') = 'array'
        and json_type(agent.value, '$.name') = 'text'
      union all
      select sm.session_id, sm.id, sm.seq,
             coalesce(json_array_length(sm.data, '$.files'), 0)
               + coalesce(json_array_length(sm.data, '$.agents'), 0) + cast(skill.key as integer),
             cast(skill.key as integer), 'skill', null, null, null, json_extract(skill.value, '$.name'), null,
             json_extract(skill.value, '$.id'), json_extract(skill.value, '$.text'),
             json_extract(skill.value, '$.mention.start'), json_extract(skill.value, '$.mention.end'),
             json_extract(skill.value, '$.mention.text')
      from session_message sm, json_each(case when json_valid(sm.data) then sm.data else '{}' end, '$.skills') skill
      where sm.type = 'user' and json_type(sm.data, '$.skills') = 'array'
        and json_type(skill.value, '$.id') = 'text' and json_type(skill.value, '$.name') = 'text'
        and json_type(skill.value, '$.text') = 'text'
    )`)
    .with("cotail_compaction", () => sql<CompactionRelation>`(
      select session_id as sessionID, id as messageID, seq as messageSeq,
             json_extract(data, '$.status') as status, json_extract(data, '$.reason') as reason,
             json_extract(data, '$.summary') as summary, json_extract(data, '$.recent') as recent,
             json_extract(data, '$.error.type') as errorType,
             json_extract(data, '$.error.message') as errorMessage,
             json_extract(data, '$.error.status') as errorStatus,
             data -> '$.metadata' as metadataJSON
      from session_message
      where type = 'compaction' and json_valid(data)
        and json_extract(data, '$.status') in ('running', 'completed', 'failed')
        and json_extract(data, '$.reason') in ('auto', 'manual')
        and ((json_extract(data, '$.status') in ('running', 'completed')
          and json_type(data, '$.summary') = 'text' and json_type(data, '$.recent') = 'text')
          or (json_extract(data, '$.status') = 'failed'
            and json_type(data, '$.error.type') = 'text' and json_type(data, '$.error.message') = 'text'))
    )`);

  // Kysely retains physical members in a CTE database type. This is the sole
  // audited narrowing from the validated physical schema to the logical world.
  return seeded as unknown as ReadonlyQueryCreator<CotailRelations>;
}
