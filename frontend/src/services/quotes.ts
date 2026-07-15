import { supabase } from '@/lib/supabase';
import type { Quote } from '@/types';

export interface QuoteFilters {
  search?: string;
  limit?: number;
  offset?: number;
}

export async function fetchQuotes(filters?: QuoteFilters): Promise<Quote[]> {
  let query = supabase
    .from('quotes')
    .select('*,quote_customers(*)')
    .order('created_at', { ascending: false });

  // Apply search filter
  if (filters?.search) {
    const searchTerm = `%${filters.search}%`;
    query = query.ilike('quote_number', searchTerm);
  }

  // Apply pagination
  if (filters?.limit) {
    query = query.limit(filters.limit);
  }

  if (filters?.offset) {
    query = query.range(filters.offset, filters.offset + (filters.limit || 10) - 1);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching quotes:', error);
    throw new Error(`Failed to fetch quotes: ${error.message}`);
  }

  return data ?? [];
}

export async function fetchQuoteById(id: string): Promise<Quote | null> {
  const { data, error } = await supabase
    .from('quotes')
    .select('*,quote_customers(*)')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error fetching quote:', error);
    throw new Error(`Failed to fetch quote: ${error.message}`);
  }

  return data;
}

export async function createQuote(quote: Omit<Quote, 'id' | 'created_at' | 'updated_at'>): Promise<Quote> {
  const { data, error } = await supabase
    .from('quotes')
    .insert([quote])
    .select('*,quote_customers(*)')
    .single();

  if (error) {
    console.error('Error creating quote:', error);
    throw new Error(`Failed to create quote: ${error.message}`);
  }

  return data;
}

export async function updateQuote(id: string, updates: Partial<Quote>): Promise<Quote> {
  const { data, error } = await supabase
    .from('quotes')
    .update(updates)
    .eq('id', id)
    .select('*,quote_customers(*)')
    .single();

  if (error) {
    console.error('Error updating quote:', error);
    throw new Error(`Failed to update quote: ${error.message}`);
  }

  return data;
}

export async function deleteQuote(id: string): Promise<void> {
  const { error } = await supabase
    .from('quotes')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting quote:', error);
    throw new Error(`Failed to delete quote: ${error.message}`);
  }
}