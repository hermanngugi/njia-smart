-- Njia Smart repair 16: maintain update timestamps on ICT knowledge and vault records.
DROP TRIGGER IF EXISTS trg_ict_knowledge_articles_updated_at ON public.ict_knowledge_articles;
CREATE TRIGGER trg_ict_knowledge_articles_updated_at BEFORE UPDATE ON public.ict_knowledge_articles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_ict_password_vault_updated_at ON public.ict_password_vault;
CREATE TRIGGER trg_ict_password_vault_updated_at BEFORE UPDATE ON public.ict_password_vault
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();