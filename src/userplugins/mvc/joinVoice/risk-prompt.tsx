import {
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalRoot,
  openModal,
} from "@utils/modal";
import { Text, useCallback } from "@webpack/common";

export function confirmReplacement(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (accepted: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(accepted);
    };
    openModal((modalProps) => {
      const accept = useCallback(() => {
        modalProps.onClose();
        finish(true);
      }, [modalProps]);
      const decline = useCallback(() => {
        modalProps.onClose();
        finish(false);
      }, [modalProps]);
      return (
        <ModalRoot {...modalProps} onClose={decline}>
          <ModalHeader>
            <Text variant="heading-lg/semibold">Replace secondary voice</Text>
          </ModalHeader>
          <ModalContent>
            <Text>
              Replace the secondary voice connection already open in this
              server?
            </Text>
          </ModalContent>
          <ModalFooter>
            <button className="mvc-button" onClick={accept} type="button">
              Replace
            </button>
            <button className="mvc-button" onClick={decline} type="button">
              Cancel
            </button>
          </ModalFooter>
        </ModalRoot>
      );
    });
  });
}
