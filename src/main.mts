import fetch from "node-fetch";
import { ContractTag, ITagService } from "atq-types";

// Define the subgraph URLs
const SUBGRAPH_URLS: Record<string, { decentralized: string }> = {
  // Ethereum Mainnet subgraph, by subgraphs.messari.eth (0x7e8f317a45d67e27e095436d2e0d47171e7c769f)
  "1": {
    decentralized:
      "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/2Bp6ibq6y7LLUoZRi4AfPmDNLrMcM6pKJCbusMPCAvzr",
  },
};

// Define the Token interface
interface Token {
  id: string;
  name: string;
  symbol: string;
}

// Define the Pool interface reflecting the GraphQL response
interface Pool {
  outputToken: Token;
  createdTimestamp: number;
}

// Define the GraphQL response structure
interface GraphQLData {
  pools: Pool[];
}

interface GraphQLResponse {
  data?: GraphQLData;
  errors?: { message: string }[]; // Assuming the API might return errors in this format
}

// Define headers for the query
const headers: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

// Define the GraphQL query
const GET_MARKETS_QUERY = `
query GetLiquidityPools($lastTimestamp: Int) {
  pools(
    first: 1000,
    orderBy: createdTimestamp,
    orderDirection: asc,
    where: { createdTimestamp_gt: $lastTimestamp }
  ) {
    outputToken {
      id
      name
      symbol
    }
    createdTimestamp
  }
}
`;

// Type guard for errors
function isError(e: unknown): e is Error {
  return (
    typeof e === "object" &&
    e !== null &&
    "message" in e &&
    typeof (e as Error).message === "string"
  );
}

// Function to check for invalid values
function containsInvalidValue(text: string): boolean {
  const containsHtml = /<[^>]*>/.test(text);
  const isEmpty = text.trim() === "";
  return isEmpty || containsHtml;
}

// Function to truncate strings
function truncateString(text: string, maxLength: number) {
  if (text.length > maxLength) {
    return text.substring(0, maxLength - 3) + "..."; // Subtract 3 for the ellipsis
  }
  return text;
}

// Function to fetch data from the GraphQL endpoint
async function fetchData(
  subgraphUrl: string,
  lastTimestamp: number
): Promise<Pool[]> {
  const response = await fetch(subgraphUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: GET_MARKETS_QUERY,
      variables: { lastTimestamp },
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }

  const result = (await response.json()) as GraphQLResponse;
  if (result.errors) {
    result.errors.forEach((error) => {
      console.error(`GraphQL error: ${error.message}`);
    });
    throw new Error("GraphQL errors occurred: see logs for details.");
  }

  if (!result.data || !result.data.pools) {
    throw new Error("No liquidity pools data found.");
  }

  return result.data.pools;
}

// Function to prepare the URL with the provided API key
function prepareUrl(chainId: string, apiKey: string): string {
  const urls = SUBGRAPH_URLS[chainId];
  if (!urls || isNaN(Number(chainId))) {
    const supportedChainIds = Object.keys(SUBGRAPH_URLS).join(", ");
    throw new Error(
      `Unsupported or invalid Chain ID provided: ${chainId}. Only the following values are accepted: ${supportedChainIds}`
    );
  }
  return urls.decentralized.replace("[api-key]", encodeURIComponent(apiKey));
}

// Function to transform pool data into ContractTag objects
function transformPoolsToTags(chainId: string, pools: Pool[]): ContractTag[] {
  const validPools: Pool[] = [];
  const rejectedSymbols: string[] = [];

  pools.forEach((pool) => {
    const symbolInvalid = containsInvalidValue(pool.outputToken.symbol);

    if (symbolInvalid) {
      rejectedSymbols.push(`Pool: ${pool.outputToken.id} rejected due to invalid symbol - Symbol: ${pool.outputToken.symbol}`);
    } else {
      validPools.push(pool);
    }
  });

  if (rejectedSymbols.length > 0) {
    console.log("Rejected pools:", rejectedSymbols);
  }

  return validPools.map((pool) => {
    const maxNameLength = 45;
    const truncatedNameText = truncateString(pool.outputToken.symbol, maxNameLength);

    return {
      "Contract Address": `eip155:${chainId}:${pool.outputToken.id}`,
      "Public Name Tag": `${truncatedNameText} Token`,
      "Project Name": "Symbiotic",
      "UI/Website Link": "https://symbiotic.fi/",
      "Public Note": `Symbiotic's ${pool.outputToken.symbol} (${pool.outputToken.name}) token contract.`,
    };
  });
}

// The main logic for this module
class TagService implements ITagService {
  returnTags = async (
    chainId: string,
    apiKey: string
  ): Promise<ContractTag[]> => {
    let allTags: ContractTag[] = [];
    let lastTimestamp: number = 0;
    let isMore = true;

    const url = prepareUrl(chainId, apiKey);

    while (isMore) {
      try {
        const pools = await fetchData(url, lastTimestamp);
        const tags = transformPoolsToTags(chainId, pools);
        allTags.push(...tags);

        isMore = pools.length === 1000; // Continue if we fetched 1000 records
        if (isMore) {
          lastTimestamp = Math.max(...pools.map(p => p.createdTimestamp));
        }
      } catch (error) {
        if (isError(error)) {
          console.error(`An error occurred: ${error.message}`);
          throw new Error(`Failed fetching data: ${error}`); // Propagate a new error with more context
        } else {
          console.error("An unknown error occurred.");
          throw new Error("An unknown error occurred during fetch operation."); // Throw with a generic error message if the error type is unknown
        }
      }
    }
    return allTags;
  };
}

// Creating an instance of TagService
const tagService = new TagService();

// Exporting the returnTags method directly
export const returnTags = tagService.returnTags;

