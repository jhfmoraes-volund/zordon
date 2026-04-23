-- Grant permissions on ChatThread and ChatMessage to service_role and authenticated
GRANT ALL ON public."ChatThread" TO service_role;
GRANT ALL ON public."ChatMessage" TO service_role;
GRANT ALL ON public."ChatThread" TO authenticated;
GRANT ALL ON public."ChatMessage" TO authenticated;
