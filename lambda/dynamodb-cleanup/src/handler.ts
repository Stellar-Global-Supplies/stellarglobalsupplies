import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const TABLE_NAME = process.env.DYNAMODB_TABLE;

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false },
  unmarshallOptions: { wrapNumbers: false },
});

interface DeleteItem {
  PK: string;
  SK: string;
}

/**
 * Scans the DynamoDB table for chat session items only — i.e. PK begins
 * with "SESSION#" (covers both session metadata, SK = META#v0, and chat
 * messages, SK = MSG#...). Everything else (agent profiles, Google OAuth
 * tokens, LinkedIn OAuth tokens) is left untouched by design — this is an
 * explicit allow-list, not a deny-list, so any new entity type added to
 * the table later is safe by default unless this filter is deliberately
 * widened.
 */
async function getSessionItems(): Promise<DeleteItem[]> {
  const items: DeleteItem[] = [];
  let lastKey: Record<string, any> | undefined;

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        ProjectionExpression: 'PK, SK',
        ExclusiveStartKey: lastKey,
        FilterExpression: 'begins_with(PK, :sessionPrefix)',
        ExpressionAttributeValues: {
          ':sessionPrefix': 'SESSION#',
        },
      }),
    );

    if (result.Items) {
      for (const item of result.Items) {
        items.push({ PK: String(item.PK), SK: String(item.SK) });
      }
    }

    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

/**
 * Deletes a batch of items from DynamoDB (max 25 per batch write).
 */
async function deleteBatch(items: DeleteItem[]): Promise<void> {
  // DynamoDB BatchWrite supports max 25 items per request
  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25);
    const deleteRequests = batch.map((item) => ({
      DeleteRequest: {
        Key: {
          PK: item.PK,
          SK: item.SK,
        },
      },
    }));

    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME!]: deleteRequests,
        },
      }),
    );
  }
}

export const handler = async () => {
  console.log('[dynamodb-cleanup] Starting daily cleanup...');
  console.log(`[dynamodb-cleanup] Table: ${TABLE_NAME}`);

  if (!TABLE_NAME) {
    console.error('[dynamodb-cleanup] DYNAMODB_TABLE environment variable is not set.');
    return { statusCode: 500, body: 'DYNAMODB_TABLE not configured' };
  }

  try {
    // Step 1: Scan for all non-agent items
    const itemsToDelete = await getNonAgentItems();
    console.log(`[dynamodb-cleanup] Found ${itemsToDelete.length} non-agent items to delete.`);

    if (itemsToDelete.length === 0) {
      console.log('[dynamodb-cleanup] No items to delete. Exiting.');
      return { statusCode: 200, body: 'No items to delete.' };
    }

    // Step 2: Delete in batches of 25
    await deleteBatch(itemsToDelete);
    console.log(`[dynamodb-cleanup] Successfully deleted ${itemsToDelete.length} items.`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        deleted_count: itemsToDelete.length,
        message: `Deleted ${itemsToDelete.length} non-agent items from ${TABLE_NAME}.`,
      }),
    };
  } catch (err) {
    console.error('[dynamodb-cleanup] Error during cleanup:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'DynamoDB cleanup failed', detail: (err as Error).message }),
    };
  }
};