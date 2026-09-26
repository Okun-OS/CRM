-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_sendingAccountId_fkey" FOREIGN KEY ("sendingAccountId") REFERENCES "SendingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
