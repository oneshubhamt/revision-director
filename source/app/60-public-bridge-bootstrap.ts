  /* ========================================================================== 
     BOOTSTRAP
     ========================================================================== */

  async function boot(): Promise<void> {
    try {
      runtimeFsrs();
      if (!PRESENTATION_KERNEL.validatePublicTokens()) throw new Error("Revision Director presentation tokens are unavailable.");
      const data = await RevisionData.open();
      const service = new RevisionService(data);
      await service.initialize();
      const activePersistence = new ActiveRetrievalPersistence(data);
      const ownership = new ReviewOwnershipCoordinator(data);
      const backupController = new BackupController(service);
      const extensions = new ExtensionRuntime(service, ownership);
      extensions.installPublicApi();
      const ui = new UIController(service, activePersistence, ownership, backupController, extensions);
      await ui.start();
      extensions.announceReady();
    } catch (error) {
      const fatal = requiredElement<HTMLDivElement>("#fatal-error");
      fatal.hidden = false;
      fatal.textContent = `Revision Director could not start: ${error instanceof Error ? error.message : String(error)}`;
      console.error(error);
    }
  }

  void boot();
