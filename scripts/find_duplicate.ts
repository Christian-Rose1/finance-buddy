import { createServerClient } from "@/lib/supabase-server";

async function main() {
  const supabase = await createServerClient();

  // 1. Look up the original purchase
  const originalId = "d0d627ce-caed-46b2-bda3-744f28648b0c";
  const { data: original, error: origErr } = await supabase
    .from("purchases")
    .select("*")
    .eq("id", originalId)
    .maybeSingle();

  if (origErr) {
    console.error("Error fetching original purchase:", origErr.message);
    process.exit(1);
  }
  if (!original) {
    console.log("Original purchase not found. It may belong to a different user or not exist.");
    process.exit(0);
  }

  console.log("=== ORIGINAL PURCHASE ===");
  console.log(JSON.stringify(original, null, 2));

  // 2. Find all purchases matching merchant, date, amount, source, user_id
  const { data: matches, error: matchErr } = await supabase
    .from("purchases")
    .select("*")
    .eq("merchant", original.merchant)
    .eq("date", original.date)
    .eq("amount", original.amount)
    .eq("source", original.source)
    .eq("user_id", original.user_id)
    .order("created_at", { ascending: true });

  if (matchErr) {
    console.error("Error fetching matching purchases:", matchErr.message);
    process.exit(1);
  }

  console.log("\n=== MATCHING PURCHASES (merchant, date, amount, source, user_id) ===");
  console.log(`Count: ${matches?.length ?? 0}`);
  if (matches) {
    for (const row of matches) {
      console.log(JSON.stringify(row, null, 2));
    }
  }
}

main().catch(console.error);